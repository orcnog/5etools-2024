import "./render-media-cues.js";

const _PARTY_SIZE_VARY_BY_RE = new RegExp([
	"[#|num|number|no.|qty|quantity|count] of [PC|player|character|hero|team|ally|party|participant|adventurer]s?",
	"[PCs|players|characters|heroes|adventurers]",
	"total [PCs|players|characters|heroes|adventurers]",
	"[#|num|number|no.|qty|quantity] in party",
	"[PC|player|character|hero|team|ally|party|participant|adventurer] count",
	"party size",
	"party members",
	"group size",
	"size of [party|team|adventuring party]",
	"team size",
	"group members",
	"adventuring party",
	"player group",
].join("|"), "i");

const _TITLE_DIFFICULTIES = {
	easy: "An easy encounter doesn't tax the characters' resources or put them in serious peril. They might lose a few hit points, but victory is pretty much guaranteed.",
	medium: "A medium encounter usually has one or two scary moments for the players, but the characters should emerge victorious with no casualties. One or more of them might need to use healing resources.",
	hard: "A hard encounter could go badly for the adventurers. Weaker characters might get taken out of the fight, and there's a slim chance that one or more characters might die.",
	deadly: "A deadly encounter could be lethal for one or more player characters. Survival often requires good tactics and quick thinking, and the party risks defeat",
	absurd: "An &quot;absurd&quot; encounter is a deadly encounter as per the rules, but is differentiated here to provide an additional tool for judging just how deadly a &quot;deadly&quot; encounter will be. It is calculated as: &quot;deadly + (deadly - hard)&quot;.",
};

class EncounterBlockCombatantUtil {
	static getCombatantCreatureTagFromEntity ({entity, displayName = ""}) {
		const parts = [
			entity.name,
			entity.source,
			displayName || "",
		];

		if (entity._isScaledCr) parts.push(`${VeCt.HASH_SCALED}=${Parser.numberToCr(entity._scaledCr)}`);
		if (entity._summonedBySpell_level) parts.push(`${VeCt.HASH_SCALED_SPELL_SUMMON}=${entity._summonedBySpell_level}`);
		if (entity._summonedByClass_level) parts.push(`${VeCt.HASH_SCALED_CLASS_SUMMON}=${entity._summonedByClass_level}`);

		while (parts.length && !parts.last()?.length) parts.pop();

		return `{@creature ${parts.join("|")}}`;
	}

	static async pGetCombatantsFromExportedSublist (exportedSublist) {
		if (!exportedSublist?.items?.length) return [];

		return exportedSublist.items
			.pSerialAwaitMap(async ser => {
				let entity = await DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, ser.h);
				if (!entity) return null;

				entity = await Renderer.hover.pApplyCustomHashId(
					UrlUtil.PG_BESTIARY,
					entity,
					ser.customHashId || ser.customhashid,
				);
				if (!entity) return null;

				const out = {
					creature: this.getCombatantCreatureTagFromEntity({
						entity,
						displayName: ser.dn || "",
					}),
					quantity: isNaN(ser.c) ? 1 : Number(ser.c),
				};
				if (ser.n) out.note = ser.n;
				return out;
			})
			.then(arr => arr.filter(Boolean));
	}

	static async pBuildExportedSublistFromCombatants ({combatants, partyLevel, partySize, name = null}) {
		const items = [];
		const sourcesSet = new Set();

		await (combatants || []).pSerialAwaitMap(async combatant => {
			if (!combatant?.creature) return;

			const [tagName, textArgs] = Renderer.splitFirstSpace(combatant.creature.slice(1, -1));
			const {hash, subhashes, displayText} = Renderer.utils.getTagMeta(tagName, textArgs);
			let entity = await DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, hash);
			if (!entity) return;

			if (displayText) entity = MiscUtil.copyFast(entity);

			const scaledCr = subhashes?.find(item => item.key === "scaled")?.value;
			if (scaledCr !== undefined) entity = await ScaleCreature.scale(entity, scaledCr);
			Renderer.monster.updateParsed(entity);

			sourcesSet.add(entity.source);

			const item = {
				h: hash,
				c: Number(combatant.quantity) > -1 ? Number(combatant.quantity) : 1,
			};

			const customHashId = Renderer.monster.getCustomHashId(entity);
			if (customHashId) item.customHashId = customHashId;
			if (displayText) item.dn = displayText;
			if (combatant.note) item.n = String(combatant.note);

			items.push(item);
		});

		return {
			items,
			sources: [...sourcesSet],
			name,
			saveId: CryptUtil.uid(),
			// Externalized party row shape (not wrapped `{id, entity}`) — required for encounter builder load.
			playersSimple: [{
				count: partySize,
				level: partyLevel,
			}],
			isAdvanced: false,
			colsExtraAdvanced: [],
			playersAdvanced: [],
			customShapeGroups: [],
		};
	}
}

class EncounterBlockSaveManagerUtil {
	static _saveManager = null;
	static _utilsListLoadPromise = null;
	static _saveManagerInitPromise = null;

	static async _pEnsureLoaded () {
		if (typeof SaveManager !== "undefined") return;

		this._utilsListLoadPromise ||= new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "js/utils-list.js";
			script.onload = resolve;
			script.onerror = reject;
			document.head.appendChild(script);
		});

		await this._utilsListLoadPromise;
	}

	static async pGet ({isReload = false} = {}) {
		await this._pEnsureLoaded();

		if (!this._saveManager) {
			this._saveManagerInitPromise ||= (async () => {
				const saveManager = new SaveManager({page: UrlUtil.PG_BESTIARY});
				await saveManager.pMutStateFromStorage();
				this._saveManager = saveManager;
			})();
			await this._saveManagerInitPromise;
		} else if (isReload) {
			await this._saveManager.pMutStateFromStorage();
		}

		return this._saveManager;
	}

	static async pGetExportedBySaveId ({saveId, isReload = true} = {}) {
		if (!saveId) return null;
		return (await this.pGet({isReload})).pGetSaveBySaveId({saveId});
	}

	static async pDeleteBySaveId ({saveId}) {
		if (!saveId) return false;
		return (await this.pGet({isReload: true})).pDoDeleteBySaveId({saveId});
	}

	static async pMutEntityBySaveId ({saveId, fnMut}) {
		if (!saveId || !fnMut) return false;

		const saveManager = await this.pGet({isReload: true});
		const save = saveManager._state.saves.find(it => it.entity?.saveId === saveId);
		if (!save) return false;

		fnMut(save.entity);
		saveManager._triggerCollectionUpdate("saves");
		await saveManager.pDoSaveStateToStorage();
		return true;
	}
}

class EncounterBlockBestiaryBridge {
	static _SUB_HASH_ENCOUNTER_BLOCK_EDIT = "encounterblockedit";
	static _STORAGE_KEY_EDIT_SUBLIST = "encounterBlockEditSublist";
	static _ENCOUNTER_BUILDER_HASH_KEY = "encounterbuilder";
	static _SUB_HASH_SUBLIST_SELECTED = "sublistselected";
	static _ENCOUNTER_BLOCK_LINK_STORAGE_PREFIX = "encounterBlockLink_";

	static _getLinkDedupeKey ({adventureId, chapterIndex, entryId, entryName, variantName}) {
		return [adventureId, chapterIndex, entryId || entryName || "", variantName || ""].join("|");
	}

	static getAdventureEncounterUrl (meta) {
		if (!meta?.adventureId || meta.chapterIndex == null) return null;

		const hashParts = [meta.adventureId, meta.chapterIndex];
		const anchor = meta.entryId || meta.entryName;
		if (anchor) hashParts.push(anchor);

		return `${UrlUtil.link(UrlUtil.PG_ADVENTURE)}#${hashParts.map(it => UrlUtil.encodeForHash(it)).join(HASH_PART_SEP)}`;
	}

	static _getLinkLabel (meta, {variantName = null} = {}) {
		const adv = meta.adventureName || meta.adventureId || "Adventure";
		const enc = meta.entryName || meta.entryId || "Encounter";
		let label = `${adv} — ${enc}`;
		if (variantName && variantName !== "_default") label += ` (${variantName})`;
		return label;
	}

	static async pGetAdventureLinksForSaveId ({saveId, adventureBlockLink = null} = {}) {
		if (!saveId) return [];

		const links = [];
		const seen = new Set();

		const addLink = (meta, {variantName = null, storageKey = null, variantKey = null} = {}) => {
			if (!meta?.adventureId || meta.chapterIndex == null) return;

			const key = this._getLinkDedupeKey({...meta, variantName});
			if (seen.has(key)) return;
			seen.add(key);

			links.push({meta: {...meta}, variantName, storageKey, variantKey});
		};

		const dump = await StorageUtil.pGetDump();
		Object.entries(dump).forEach(([storageKey, stored]) => {
			if (!storageKey.startsWith(this._ENCOUNTER_BLOCK_LINK_STORAGE_PREFIX)) return;

			const migrated = AdventureEncounterBlockControls.mutMigrateStoredUserState(stored);
			if (!migrated?.variants) return;

			Object.entries(migrated.variants).forEach(([variantKey, variantEntry]) => {
				if (variantEntry?.linkedSaveId !== saveId) return;

				const variantName = variantKey === "_default" ? null : variantKey;
				if (variantEntry.adventureBlockLink) {
					addLink(variantEntry.adventureBlockLink, {variantName, storageKey, variantKey});
					return;
				}

				if (!adventureBlockLink) return;

				const suffix = storageKey.slice(this._ENCOUNTER_BLOCK_LINK_STORAGE_PREFIX.length);
				const splitIx = suffix.indexOf("_");
				if (splitIx === -1) return;

				const entryIdGuess = suffix.slice(splitIx + 1).replace(/-/g, "_");
				addLink({
					...adventureBlockLink,
					entryId: adventureBlockLink.entryId || entryIdGuess,
				}, {variantName, storageKey, variantKey});
			});
		});

		if (!links.length && adventureBlockLink) addLink(adventureBlockLink, {storageKey: null, variantKey: null});

		links.sort((a, b) => SortUtil.ascSortLower(
			this._getLinkLabel(a.meta, {variantName: a.variantName}),
			this._getLinkLabel(b.meta, {variantName: b.variantName}),
		));

		return links;
	}

	static async _pConfirmUnlinkFromBestiary ({saveName, linkLabel}) {
		const {eleModalInner, doClose, pGetResolved, doAutoResize: doAutoResizeModal} = await InputUiUtil._pGetShowModal({
			title: "Unlink Adventure",
			isMinHeight0: true,
		});

		ee`<div class="ve-flex ve-w-100 ve-mb-1">Unlink pinned list "<strong>${(saveName || "Saved List").qq()}</strong>" from <strong>${(linkLabel || "this adventure encounter").qq()}</strong>? The list will be kept.</div>`
			.appendTo(eleModalInner);

		const btnUnlink = ee`<button type="button" class="ve-btn ve-btn-primary ve-mr-2">Unlink</button>`
			.onn("click", evt => {
				evt.stopPropagation();
				doClose(true);
			});

		const btnCancel = ee`<button type="button" class="ve-btn ve-btn-default">Cancel</button>`
			.onn("click", evt => {
				evt.stopPropagation();
				doClose(false);
			});

		ee`<div class="ve-flex-v-center ve-flex-h-right ve-py-1 ve-px-1">${btnUnlink}${btnCancel}</div>`
			.appendTo(eleModalInner);

		if (doAutoResizeModal) doAutoResizeModal();
		btnUnlink.focuse();

		const [isConfirmed] = await pGetResolved();
		return !!isConfirmed;
	}

	static async _pSyncSaveAdventureBlockLinkStamp ({saveId}) {
		if (!saveId) return;

		const remaining = await this.pGetAdventureLinksForSaveId({saveId});

		await EncounterBlockSaveManagerUtil.pMutEntityBySaveId({
			saveId,
			fnMut: entity => {
				if (!remaining.length) delete entity.adventureBlockLink;
				else entity.adventureBlockLink = remaining[0].meta;
			},
		});
	}

	static async pUnlinkSaveIdFromAdventureLink ({saveId, storageKey, variantKey, meta, variantName} = {}) {
		if (!saveId || !storageKey || variantKey == null) return false;

		const stored = await StorageUtil.pGet(storageKey);
		const migrated = AdventureEncounterBlockControls.mutMigrateStoredUserState(stored);
		const variantEntry = migrated?.variants?.[variantKey];

		if (variantEntry?.linkedSaveId !== saveId) return false;

		if (meta?.adventureId && variantEntry.adventureBlockLink) {
			const key = this._getLinkDedupeKey({...variantEntry.adventureBlockLink, variantName: variantKey === "_default" ? null : variantKey});
			const targetKey = this._getLinkDedupeKey({...meta, variantName});
			if (key !== targetKey) return false;
		}

		delete variantEntry.linkedSaveId;
		delete variantEntry.linkedSaveName;
		delete variantEntry.adventureBlockLink;

		await StorageUtil.pSet(storageKey, {
			selectedVariantName: migrated.selectedVariantName ?? null,
			variants: migrated.variants,
		});

		await this._pSyncSaveAdventureBlockLinkStamp({saveId});

		return true;
	}

	static async pUnlinkSaveIdFromAdventures ({saveId, adventureBlockLink = null} = {}) {
		if (!saveId) return false;

		const links = await this.pGetAdventureLinksForSaveId({saveId, adventureBlockLink});
		if (!links.length) return false;

		let didUnlink = false;
		for (const link of links) {
			if (link.storageKey == null || link.variantKey == null) continue;
			if (await this.pUnlinkSaveIdFromAdventureLink({saveId, ...link})) didUnlink = true;
		}

		if (!didUnlink && adventureBlockLink) {
			await this._pSyncSaveAdventureBlockLinkStamp({saveId});
			const remaining = await this.pGetAdventureLinksForSaveId({saveId});
			if (!remaining.length) return true;
		}

		return didUnlink;
	}

	static _mutClearSaveAdventureBlockLink ({save, comp} = {}) {
		if (save?.entity?.adventureBlockLink) delete save.entity.adventureBlockLink;
		if (comp?._state?.adventureBlockLink) delete comp._state.adventureBlockLink;
	}

	static async pRenderSaveSummaryAdventureLinks ({save, comp, wrp, hkRefresh}) {
		if (!wrp) return;

		const renderId = (wrp._encounterBlockLinkRenderId = (wrp._encounterBlockLinkRenderId || 0) + 1);
		wrp.empty();

		const saveId = save?.entity?.saveId;
		if (!saveId) return;

		const links = await this.pGetAdventureLinksForSaveId({
			saveId,
			adventureBlockLink: save.entity.adventureBlockLink,
		});

		if (renderId !== wrp._encounterBlockLinkRenderId) return;
		if (!links.length) return;

		const wrpRow = ee`<div class="ve-small ve-muted encounter-block-bestiary-link-indicator__row ve-flex-col ve-min-w-0"></div>`.appendTo(wrp);

		const wrpHeader = ee`<div class="ve-flex-v-center ve-w-100 ve-min-w-0"></div>`
			.appendTo(wrpRow)
			.appends(ee`<span class="glyphicon glyphicon-link ve-no-shrink ve-mr-1"></span><span class="ve-no-shrink">${links.length === 1 ? "Linked Adventure Encounter:" : "Linked Adventure Encounters:"}</span>`);

		const wrpLinks = ee`<ul class="ve-my-0 ve-p-0 encounter-block-bestiary-link-indicator__list"></ul>`.appendTo(wrpRow);

		links.forEach(link => {
			const {meta, variantName, storageKey, variantKey} = link;
			const url = this.getAdventureEncounterUrl(meta);
			const label = this._getLinkLabel(meta, {variantName});
			const li = ee`<li class="encounter-block-bestiary-link-indicator__item ve-flex-v-center ve-min-w-0"></li>`;
			const wrpLink = ee`<span class="ve-flex-1 ve-min-w-0 encounter-block-bestiary-link-indicator__link"></span>`.appendTo(li);

			if (url) {
				wrpLink.appends(ee`<a href="${url.qq()}" target="_blank" rel="noopener noreferrer">${label.qq()}</a>`);
			} else {
				wrpLink.txt(label);
			}

			ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-no-shrink encounter-block-bestiary-link-indicator__btn-unlink" title="Unlink this adventure encounter">Unlink</button>`
				.appendTo(li)
				.onn("click", async (evt) => {
					evt.stopPropagation();

					const saveName = save.entity?.name || "(Unnamed List)";
					if (!await this._pConfirmUnlinkFromBestiary({saveName, linkLabel: label})) return;

					const didUnlink = await this.pUnlinkSaveIdFromAdventureLink({
						saveId,
						storageKey,
						variantKey,
						meta,
						variantName,
					});
					if (!didUnlink) {
						JqueryUtil.doToast({content: "Could not unlink this adventure encounter.", type: "warning"});
						return;
					}

					const remaining = await this.pGetAdventureLinksForSaveId({saveId});
					if (!remaining.length) this._mutClearSaveAdventureBlockLink({save, comp});

					JqueryUtil.doToast({content: `Unlinked from ${label}.`, type: "success"});
					hkRefresh?.();
				});

			wrpLinks.appends(li);
		});
	}

	static _mutStripLoadedSubHashesFromUrl ({unpacked, excludeKeys}) {
		const [link] = Hist.getHashParts();
		const outSub = [];
		Object.keys(unpacked)
			.filter(k => !excludeKeys.includes(k))
			.forEach(k => {
				outSub.push(`${k}${HASH_SUB_KV_SEP}${unpacked[k].clean.join(HASH_SUB_LIST_SEP)}`);
			});
		Hist.setSuppressHistory(true);
		window.location.hash = `#${link}${outSub.length ? `${HASH_PART_SEP}${outSub.join(HASH_PART_SEP)}` : ""}`;
	}

	static async pMutSetFromSubHashes ({unpacked, sublistManager, pFnPreLoad}) {
		const encounterBlockEdit = unpacked[this._SUB_HASH_ENCOUNTER_BLOCK_EDIT]?.clean;
		if (encounterBlockEdit?.[0] !== "true") return false;

		const stored = await StorageUtil.pGet(this._STORAGE_KEY_EDIT_SUBLIST);
		await StorageUtil.pRemove(this._STORAGE_KEY_EDIT_SUBLIST);

		if (stored) {
			if (pFnPreLoad) await pFnPreLoad(stored);
			await sublistManager.pDoLoadExportedSublist(stored);
			this._mutStripLoadedSubHashesFromUrl({
				unpacked,
				excludeKeys: [this._SUB_HASH_ENCOUNTER_BLOCK_EDIT, this._SUB_HASH_SUBLIST_SELECTED],
			});
		}

		return true;
	}

	static getEditInBestiaryHashParts () {
		return [
			HASH_BLANK,
			UrlUtil.packSubHash(this._ENCOUNTER_BUILDER_HASH_KEY, ["true"]),
			UrlUtil.packSubHash(this._SUB_HASH_ENCOUNTER_BLOCK_EDIT, ["true"]),
		];
	}
}

class AdventureEncounterBlockControls {
	static _STORAGE_KEY_PREFIX = "encounterBlockLink_";

	static getBlockStorageKey (block) {
		const idPart = block._entry.id || `encounter-${block._encounterNumber}`;
		const advPart = (block._adventureName || "adventure").toUrlified();
		return `${this._STORAGE_KEY_PREFIX}${advPart}_${idPart.toUrlified()}`;
	}

	static mutMigrateStoredUserState (stored) {
		if (!stored) return null;

		const out = {
			selectedVariantName: stored.selectedVariantName ?? null,
			variants: {...(stored.variants || {})},
		};

		// Legacy: top-level link/party fields -> current or default variant bucket.
		if (stored.linkedSaveId != null || stored.linkedSaveName != null || stored.partyLevel != null) {
			const legacyKey = out.selectedVariantName != null
				? String(out.selectedVariantName)
				: "_default";

			out.variants[legacyKey] = {
				...(out.variants[legacyKey] || {}),
				...(stored.partyLevel != null ? {partyLevel: stored.partyLevel} : {}),
				...(stored.linkedSaveId != null ? {linkedSaveId: stored.linkedSaveId} : {}),
				...(stored.linkedSaveName != null ? {linkedSaveName: stored.linkedSaveName} : {}),
			};
		}

		// Legacy: global partyLevel with variants map but no per-variant party levels.
		if (stored.partyLevel != null && !Object.values(out.variants).some(it => it?.partyLevel != null)) {
			const fallbackKey = out.selectedVariantName != null
				? String(out.selectedVariantName)
				: Object.keys(out.variants)[0] || "_default";
			out.variants[fallbackKey] = {
				...(out.variants[fallbackKey] || {}),
				partyLevel: stored.partyLevel,
			};
		}

		return out;
	}

	constructor ({block}) {
		this._block = block;
		this._blockStorageKey = this.constructor.getBlockStorageKey(block);
		this._storedUserState = null;
		this._eleRoot = null;
		this._dispLinkStatus = null;
	}

	async pInit ({ele}) {
		this._eleRoot = e_({ele});
		this._storedUserState = this.constructor.mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey));
		await this._renderUi();
		await this._pRestoreFromStorage();
	}

	_getVariantStorageKey (variantName = null) {
		if (!this._block._entry.variations?.length) return "_default";
		const raw = variantName ?? this._block._getSelectedVariantName();
		return raw == null ? "_default" : String(raw);
	}

	_getStoredVariantEntry (stored, variantKey) {
		return stored?.variants?.[variantKey] ?? null;
	}

	_getCurrentVariantEntry () {
		return MiscUtil.copyFast(this._getStoredVariantEntry(this._storedUserState, this._getVariantStorageKey()) || {});
	}

	_getStoredUserStateBase () {
		return {
			selectedVariantName: this._block._entry.variations?.length ? this._block._getSelectedVariantName() : null,
			variants: {...(this._storedUserState?.variants || {})},
		};
	}

	_buildVariantEntryForVariant ({variantName = null, linkedSaveId, linkedSaveName, adventureBlockLink} = {}) {
		const variantKey = this._getVariantStorageKey(variantName);
		const existing = this._getStoredVariantEntry(this._storedUserState, variantKey) || {};

		const out = {
			...MiscUtil.copyFast(existing),
			partyLevel: this._block._getPartyLevel(),
		};

		if (linkedSaveId !== undefined) {
			out.linkedSaveId = linkedSaveId;
			if (linkedSaveId == null) delete out.adventureBlockLink;
		}
		if (linkedSaveName !== undefined) out.linkedSaveName = linkedSaveName;
		if (adventureBlockLink !== undefined) {
			if (adventureBlockLink == null) delete out.adventureBlockLink;
			else out.adventureBlockLink = adventureBlockLink;
		}

		return out;
	}

	async _pPersistVariantState ({variantName = null, linkedSaveId, linkedSaveName, adventureBlockLink} = {}) {
		const variantKey = this._getVariantStorageKey(variantName);

		this._storedUserState = {
			...this._getStoredUserStateBase(),
			variants: {
				...(this._storedUserState?.variants || {}),
				[variantKey]: this._buildVariantEntryForVariant({variantName, linkedSaveId, linkedSaveName, adventureBlockLink}),
			},
		};

		await StorageUtil.pSet(this._blockStorageKey, this._storedUserState);
	}

	async _pPersistSelectedVariantName () {
		this._storedUserState = {
			...this._getStoredUserStateBase(),
			variants: {...(this._storedUserState?.variants || {})},
		};
		await StorageUtil.pSet(this._blockStorageKey, this._storedUserState);
	}

	async _pApplyVariantState ({variantName = null} = {}) {
		const variantEntry = this._getStoredVariantEntry(this._storedUserState, this._getVariantStorageKey(variantName)) || {};

		if (variantEntry.partyLevel != null) {
			this._block._getBlockEle("-party-level-select")?.val(String(variantEntry.partyLevel));
		}

		await this._pUpdateLinkDisplay();
	}

	async _pRestoreFromStorage () {
		if (!this._storedUserState) return;

		if (this._storedUserState.selectedVariantName != null && this._block._entry.variations?.length) {
			this._block._pSetVariationSelectValue(this._storedUserState.selectedVariantName);
		}

		await this._pApplyVariantState();
	}

	async _pPersistUserState () {
		await this._pPersistVariantState();
	}

	async _pSetVariantLink ({linkedSaveId, linkedSaveName}) {
		await this._pPersistVariantState({
			linkedSaveId: linkedSaveId ?? null,
			linkedSaveName: linkedSaveName ?? null,
			adventureBlockLink: linkedSaveId == null ? null : this._getAdventureBlockLinkMeta(),
		});
		this._updateLinkDisplay();
	}

	getLinkedSaveId () {
		return this._getCurrentVariantEntry()?.linkedSaveId ?? null;
	}

	getLinkedSaveName () {
		return this._getCurrentVariantEntry()?.linkedSaveName ?? null;
	}

	isLinked () {
		return !!this.getLinkedSaveId();
	}

	async pGetLinkedExportedSublist () {
		const saveId = this.getLinkedSaveId();
		if (!saveId) return null;

		return EncounterBlockSaveManagerUtil.pGetExportedBySaveId({saveId});
	}

	_getAdventureBlockLinkMeta () {
		const entry = this._block._entry;
		const chapterIndex = globalThis.BookUtil?.curRender?.chapter;

		return {
			adventureId: globalThis.BookUtil?.curRender?.curBookId ?? null,
			adventureName: this._block._adventureName || globalThis.BookUtil?.curRender?.fromIndex?.name || null,
			chapterIndex: Number.isFinite(chapterIndex) ? chapterIndex : null,
			entryId: entry?.id ?? null,
			entryName: entry?.name ?? null,
		};
	}

	async _pStampAdventureBlockLinkOnSavedList ({saveId}) {
		if (!saveId) return;

		const adventureBlockLink = this._getAdventureBlockLinkMeta();
		if (!adventureBlockLink.adventureId || adventureBlockLink.chapterIndex == null) return;

		await EncounterBlockSaveManagerUtil.pMutEntityBySaveId({
			saveId,
			fnMut: entity => {
				entity.adventureBlockLink = adventureBlockLink;
			},
		});
	}

	async _pClearAdventureBlockLinkOnSavedList ({saveId}) {
		if (!saveId) return;

		await EncounterBlockSaveManagerUtil.pMutEntityBySaveId({
			saveId,
			fnMut: entity => {
				if (entity.adventureBlockLink) delete entity.adventureBlockLink;
			},
		});
	}

	async _pDeleteLinkedSavedList ({saveId}) {
		return EncounterBlockSaveManagerUtil.pDeleteBySaveId({saveId});
	}

	async _pEnsureLinkedSaveValid () {
		const saveId = this.getLinkedSaveId();
		if (!saveId) return false;

		if (await EncounterBlockSaveManagerUtil.pGetExportedBySaveId({saveId})) return false;

		await this._pSetVariantLink({linkedSaveId: null, linkedSaveName: null});
		return true;
	}

	async _pUpdateLinkDisplay () {
		await this._pEnsureLinkedSaveValid();
		this._updateLinkDisplay();
	}

	async _pPromptLinkedListDisposition ({
		title,
		message,
		primaryLabel,
	}) {
		const {eleModalInner, doClose, pGetResolved, doAutoResize: doAutoResizeModal} = await InputUiUtil._pGetShowModal({
			title,
			isMinHeight0: true,
		});

		ee`<div class="ve-flex ve-w-100 ve-mb-1">${message}</div>`
			.appendTo(eleModalInner);

		const btnPrimary = ee`<button type="button" class="ve-btn ve-btn-primary ve-mr-2">${primaryLabel}</button>`
			.onn("click", evt => {
				evt.stopPropagation();
				doClose(true, "keep");
			});

		const btnDelete = ee`<button type="button" class="ve-btn ve-btn-danger ve-mr-2">Unlink &amp; Delete List</button>`
			.onn("click", evt => {
				evt.stopPropagation();
				doClose(true, "delete");
			});

		const btnCancel = ee`<button type="button" class="ve-btn ve-btn-default">Cancel</button>`
			.onn("click", evt => {
				evt.stopPropagation();
				doClose(false);
			});

		ee`<div class="ve-flex-v-center ve-flex-h-right ve-py-1 ve-px-1">${btnPrimary}${btnDelete}${btnCancel}</div>`
			.appendTo(eleModalInner);

		if (doAutoResizeModal) doAutoResizeModal();
		btnPrimary.focuse();

		const [isDataEntered, out] = await pGetResolved();
		if (!isDataEntered) return null;
		return out;
	}

	async _pDisposePreviousLinkedList ({saveId, title, message, primaryLabel}) {
		if (!saveId) return true;

		const action = await this._pPromptLinkedListDisposition({title, message, primaryLabel});
		if (action == null) return false;

		if (action === "delete") {
			await this._pDeleteLinkedSavedList({saveId});
		} else {
			await this._pClearAdventureBlockLinkOnSavedList({saveId});
		}

		return true;
	}

	async _renderUi () {
		this._eleRoot.empty();

		this._dispLinkStatus = ee`<span class="encounter-block-link-controls__status ve-muted ve-small"></span>`;

		const btnLink = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-link" title="Link to a saved Bestiary pinned list"><span class="glyphicon glyphicon-link"></span></button>`
			.onn("click", evt => this._pHandleLink(evt));

		const btnSave = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-save" title="Save this encounter as a new Bestiary pinned list and link it"><span class="glyphicon glyphicon-floppy-disk"></span></button>`
			.onn("click", evt => this._pHandleSaveAsNew(evt));

		const btnChange = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-change" title="Load a different saved Bestiary pinned list"><span class="glyphicon glyphicon-link"></span></button>`
			.onn("click", evt => this._pHandleLink(evt));

		const btnRefresh = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-refresh" title="Refresh from Pinned Bestiary List"><span class="glyphicon glyphicon-refresh"></span></button>`
			.onn("click", evt => this._pHandleRefreshLinkedList(evt));

		const btnUnlink = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-unlink" title="Unlink & load original creatures from adventure"><span class="glyphicon glyphicon-remove"></span></button>`
			.onn("click", evt => this._pHandleUnlink(evt));

		const btnEdit = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default encounter-block-link-controls__btn-edit" title="Edit linked list in Bestiary Encounter Builder"><span class="glyphicon glyphicon-pencil"></span></button>`
			.onn("click", evt => this._pHandleEditInBestiary(evt));

		this._btnSave = btnSave;
		this._btnLink = btnLink;
		this._btnChange = btnChange;
		this._btnRefresh = btnRefresh;
		this._btnUnlink = btnUnlink;
		this._btnEdit = btnEdit;

		ee(this._eleRoot)`
			<div class="encounter-block-link-controls no-print ve-flex-v-center ve-flex-wrap">
				${this._dispLinkStatus}
				<div class="ve-btn-group encounter-block-link-controls__btns ve-ml-1">
					${btnLink}
					${btnSave}
					${btnChange}
					${btnRefresh}
					${btnUnlink}
					${btnEdit}
				</div>
			</div>`;

		await this._pUpdateLinkDisplay();
	}

	_updateLinkDisplay () {
		const isLinked = this.isLinked();
		const name = this.getLinkedSaveName();

		this._dispLinkStatus?.html(isLinked
			? `<span class="glyphicon glyphicon-pushpin ve-mr-1"></span>Linked bestiary list: <strong>${name?.qq() || "Saved List"}</strong>`
			: `<span class="glyphicon glyphicon-info-sign ve-mr-1"></span>Not linked to a pinned bestiary list`);

		this._btnLink?.toggleVe(!isLinked);
		this._btnSave?.toggleVe(!isLinked);
		this._btnChange?.toggleVe(isLinked);
		this._btnRefresh?.toggleVe(isLinked);
		this._btnUnlink?.toggleVe(isLinked);
		this._btnEdit?.toggleVe(isLinked);
	}

	async _pHandleLink (evt) {
		evt?.stopPropagation?.();

		const previousSaveId = this.getLinkedSaveId();
		const previousSaveName = this.getLinkedSaveName() || "Saved List";

		const saveManager = await EncounterBlockSaveManagerUtil.pGet();
		if (!await saveManager.pHasSaves()) {
			JqueryUtil.doToast({
				content: "No saved pinned lists found. Open the Bestiary, build an encounter, and save it as a pinned list first.",
				type: "warning",
			});
			return;
		}

		const exportedSublist = await saveManager.pDoLoad({isIncludeManagerClientState: true});
		if (!exportedSublist?.saveId) return;

		if (previousSaveId === exportedSublist.saveId) return;

		if (previousSaveId) {
			const didDispose = await this._pDisposePreviousLinkedList({
				saveId: previousSaveId,
				title: "Change Linked List",
				message: `This encounter is currently linked to pinned list "<strong>${previousSaveName.qq()}</strong>". What would you like to do with the previous list?`,
				primaryLabel: "Unlink & Keep List",
			});
			if (!didDispose) return;
		}

		await this._pSetVariantLink({
			linkedSaveId: exportedSublist.saveId,
			linkedSaveName: exportedSublist.name || "(Unnamed List)",
		});

		await this._pStampAdventureBlockLinkOnSavedList({saveId: exportedSublist.saveId});

		await this._block.pRefreshDisplay();
	}

	async _pHandleSaveAsNew (evt) {
		evt?.stopPropagation?.();

		const defaultName = this._block._getDefaultSaveName();
		const name = await InputUiUtil.pGetUserString({
			title: "Save as Pinned List",
			default: defaultName,
		});
		if (!name?.trim()) return;

		const combatants = this._block._getJsonCombatantsForCurrentSelection();
		if (!combatants.length) {
			JqueryUtil.doToast({content: "This encounter has no creatures to save.", type: "warning"});
			return;
		}

		const trimmedName = name.trim();
		const previousSaveId = this.getLinkedSaveId();
		const previousSaveName = this.getLinkedSaveName() || "Saved List";

		try {
			const exportedSublist = await EncounterBlockCombatantUtil.pBuildExportedSublistFromCombatants({
				combatants,
				partyLevel: this._block._getPartyLevel(),
				partySize: this._block._getPartySize(),
				name: trimmedName,
			});

			const saveManager = await EncounterBlockSaveManagerUtil.pGet({isReload: true});

			const didNew = await saveManager.pDoNew(null);
			if (!didNew) return;

			exportedSublist.name = trimmedName;
			exportedSublist.adventureBlockLink = this._getAdventureBlockLinkMeta();
			const saveInfo = await saveManager.pDoSave(exportedSublist);
			if (!saveInfo?.saveId) return;

			await saveManager.pDoSaveStateToStorage();

			if (previousSaveId && previousSaveId !== saveInfo.saveId) {
				const didDispose = await this._pDisposePreviousLinkedList({
					saveId: previousSaveId,
					title: "Change Linked List",
					message: `This encounter is currently linked to pinned list "<strong>${previousSaveName.qq()}</strong>". What would you like to do with the previous list?`,
					primaryLabel: "Unlink & Keep List",
				});
				if (!didDispose) return;
			}

			await this._pSetVariantLink({
				linkedSaveId: saveInfo.saveId,
				linkedSaveName: trimmedName,
			});

			await this._block.pRefreshDisplay();

			JqueryUtil.doToast({content: `Saved and linked pinned list "${trimmedName}".`, type: "success"});
		} catch (err) {
			JqueryUtil.doToast({content: `Failed to save pinned list: ${err.message}`, type: "danger"});
			throw err;
		}
	}

	async _pReloadStoredUserStateFromStorage () {
		this._storedUserState = this.constructor.mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey));
	}

	async _pSyncLinkStateFromStorage ({isReloadSaveManager = false} = {}) {
		await this._pReloadStoredUserStateFromStorage();

		let saveId = this.getLinkedSaveId();
		if (!saveId) return false;

		const exportedSublist = await EncounterBlockSaveManagerUtil.pGetExportedBySaveId({
			saveId,
			isReload: isReloadSaveManager,
		});
		if (!exportedSublist) {
			await this._pSetVariantLink({linkedSaveId: null, linkedSaveName: null});
			return false;
		}

		const links = await EncounterBlockBestiaryBridge.pGetAdventureLinksForSaveId({
			saveId,
			adventureBlockLink: exportedSublist.adventureBlockLink,
		});
		const variantKey = this._getVariantStorageKey();
		const stillLinked = links.some(link => link.storageKey === this._blockStorageKey && link.variantKey === variantKey);
		if (!stillLinked) {
			await this._pSetVariantLink({linkedSaveId: null, linkedSaveName: null});
			return false;
		}

		const linkedSaveName = exportedSublist.name || "(Unnamed List)";
		if (linkedSaveName !== this.getLinkedSaveName()) {
			await this._pSetVariantLink({linkedSaveId: saveId, linkedSaveName});
		}

		return true;
	}

	async _pHandleRefreshLinkedList (evt) {
		evt?.stopPropagation?.();

		if (!await this._pSyncLinkStateFromStorage({isReloadSaveManager: true})) {
			await this._pUpdateLinkDisplay();
			await this._block.pRefreshDisplay();
			JqueryUtil.doToast({content: "This encounter is no longer linked to a pinned bestiary list.", type: "info"});
			return;
		}

		await this._block.pRefreshDisplay();
	}

	async _pHandleUnlink (evt) {
		evt?.stopPropagation?.();

		const saveId = this.getLinkedSaveId();
		const saveName = this.getLinkedSaveName() || "Saved List";
		if (!saveId) return;

		const action = await this._pPromptLinkedListDisposition({
			title: "Unlink Encounter",
			message: `This encounter is linked to pinned list "<strong>${saveName.qq()}</strong>". What would you like to do?`,
			primaryLabel: "Unlink",
		});
		if (action == null) return;

		await this._pSetVariantLink({linkedSaveId: null, linkedSaveName: null});

		if (action === "delete") {
			await this._pDeleteLinkedSavedList({saveId});
		} else {
			await this._pClearAdventureBlockLinkOnSavedList({saveId});
		}

		await this._block.pRefreshDisplay();
	}

	async _pHandleEditInBestiary (evt) {
		evt?.stopPropagation?.();

		const saveId = this.getLinkedSaveId();
		if (!saveId) return;

		const exportedSublist = await EncounterBlockSaveManagerUtil.pGetExportedBySaveId({saveId, isReload: true});
		if (!exportedSublist) {
			await this._pSetVariantLink({linkedSaveId: null, linkedSaveName: null});
			await this._block.pRefreshDisplay();
			JqueryUtil.doToast({content: "Could not find the linked pinned list. It may have been deleted.", type: "danger"});
			return;
		}

		if (!exportedSublist.adventureBlockLink) {
			exportedSublist.adventureBlockLink = this._getAdventureBlockLinkMeta();
		}

		// Avoid embedding JSON in the URL hash — packSubHash/toUrlified lowercases the entire payload.
		await StorageUtil.pSet(EncounterBlockBestiaryBridge._STORAGE_KEY_EDIT_SUBLIST, exportedSublist);

		window.open(
			`${UrlUtil.link(UrlUtil.PG_BESTIARY)}#${EncounterBlockBestiaryBridge.getEditInBestiaryHashParts().join(HASH_PART_SEP)}`,
			"_blank",
			"noopener,noreferrer",
		);
	}

	async pOnVariationChange ({previousVariantName} = {}) {
		if (previousVariantName != null) {
			await this._pPersistVariantState({variantName: previousVariantName});
		}

		await this._pPersistSelectedVariantName();
		await this._pApplyVariantState();
		await this._block.pRefreshDisplay();
	}

	async pOnPartyLevelChange () {
		await this._pPersistUserState();
		await this._block.pUpdateXpAndInitiative();
	}
}

class AdventureEncounterBlock {
	static _blockLookup = {};

	constructor ({blockId, entry, encounterNumber, adventureName, defaultVariant}) {
		this._blockId = blockId;
		this._entry = entry;
		this._encounterNumber = encounterNumber;
		this._adventureName = adventureName;
		this._defaultVariant = defaultVariant;
		this._renderer = null;
		this._meta = null;
		this._options = null;
		this._controls = null;
	}

	_getBlockEle (suffix = "") {
		return RendererEncounterBlock._getEncounterBlockEleById(this._blockId, suffix);
	}

	_getDefaultSaveName () {
		const entryName = this._entry.name || `Encounter ${this._encounterNumber}`;
		const partySize = this._getPartySize();
		if (this._entry.variations?.length && _PARTY_SIZE_VARY_BY_RE.test(this._entry.varyBy || "")) {
			return `${entryName} (${partySize}P)`;
		}
		return entryName;
	}

	_getPartyLevel () {
		const raw = Number(this._getBlockEle("-party-level-select")?.val());
		return Math.min(20, Math.max(1, Number.isFinite(raw) && raw > 0 ? raw : 3));
	}

	_getPartySize () {
		if (this._entry.variations?.length && _PARTY_SIZE_VARY_BY_RE.test(this._entry.varyBy || "")) {
			const variant = this._getSelectedVariantName();
			const n = Number(variant);
			if (Number.isFinite(n) && n > 0) return n;
		}
		return 4;
	}

	_getSelectedVariantName () {
		const variationSelect = this._getBlockEle("-variation-select");
		if (variationSelect) return variationSelect.val();
		return this._defaultVariant?.variantName ?? null;
	}

	_getSelectedVariation () {
		if (!this._entry.variations?.length) return null;
		const variantName = this._getSelectedVariantName();
		return this._entry.variations.find(v => String(v.variantName) === String(variantName))
			|| this._defaultVariant
			|| this._entry.variations[0];
	}

	_pSetVariationSelectValue (selectedVariantName) {
		const ele = document.getElementById(`${this._blockId}-variation-select`);
		if (!ele || selectedVariantName == null) return false;

		const target = String(selectedVariantName);
		if (![...ele.options].some(opt => String(opt.value) === target)) return false;

		ele.value = target;
		return true;
	}

	_getJsonEncounterDataForCurrentSelection () {
		if (this._entry.combatants?.length) {
			return {
				combatants: this._entry.combatants,
				notes: this._entry.notes,
			};
		}

		const variation = this._getSelectedVariation();
		if (!variation) return {combatants: [], notes: []};

		return {
			combatants: variation.combatants || [],
			notes: RendererEncounterBlock._mergeEncounterBlockNotes(this._entry, variation),
		};
	}

	_getJsonCombatantsForCurrentSelection () {
		return this._getJsonEncounterDataForCurrentSelection().combatants || [];
	}

	async pGetCombatantsForDisplay () {
		if (this._controls?.isLinked()) {
			const exported = await this._controls.pGetLinkedExportedSublist();
			if (exported?.items?.length) {
				return EncounterBlockCombatantUtil.pGetCombatantsFromExportedSublist(exported);
			}
		}

		return MiscUtil.copyFast(this._getJsonCombatantsForCurrentSelection());
	}

	async pGetEncounterDataForDisplay () {
		const jsonData = this._getJsonEncounterDataForCurrentSelection();
		const combatants = await this.pGetCombatantsForDisplay();
		return {
			combatants,
			notes: jsonData.notes || RendererEncounterBlock._mergeEncounterBlockNotes(this._entry, this._getSelectedVariation() || {}),
		};
	}

	async pRefreshDisplay () {
		const encounterData = await this.pGetEncounterDataForDisplay();
		const meta = MiscUtil.copyFast(this._meta || {depth: 2});
		const creatureHtml = RendererEncounterBlock._renderEncounterCreatures.call(
			this._renderer,
			encounterData,
			[""],
			meta,
			this._options || {},
		);
		const notesHtml = RendererEncounterBlock._renderEncounterNotes.call(
			this._renderer,
			encounterData,
			[""],
			meta,
			this._options || {},
		);

		this._getBlockEle("-creatures")?.html(creatureHtml + notesHtml);
		await this._controls?._pUpdateLinkDisplay?.();
		await this.pUpdateXpAndInitiative();
	}

	async pUpdateXpAndInitiative () {
		const encounterData = await this.pGetEncounterDataForDisplay();
		await RendererEncounterBlock._renderEncounterAdjXp.call(
			this._renderer,
			this._blockId,
			encounterData,
			this._getSelectedVariantName() ?? this._defaultVariant?.variantName,
			this._entry,
			this._meta,
			this._options,
			{
				partySize: this._getPartySize(),
				partyLevel: this._getPartyLevel(),
			},
		);
	}

	_setupHeaderControlHandlers () {
		RendererEncounterBlock._setupEncounterHeaderControlHandlers.call(
			this._renderer,
			this._blockId,
			this._entry,
			this._defaultVariant,
			this._meta,
			this._options,
			this,
		);
	}

	async pInit ({renderer, meta, options}) {
		this._renderer = renderer;
		this._meta = meta;
		this._options = options;

		const controlsEle = document.getElementById(`${this._blockId}-link-controls`);
		if (controlsEle) {
			this._controls = new AdventureEncounterBlockControls({block: this});
			await this._controls.pInit({ele: controlsEle});
		}

		this._setupHeaderControlHandlers();
		await this.pRefreshDisplay();
	}

	static pRender (renderer, entry, textStack, meta, options) {
		if (!entry?.combatants?.length && (!entry?.variations?.length || entry.variations.every(v => v?.combatants?.length <= 0))) return;

		meta.encounterBlockIndex = (meta.encounterBlockIndex ?? 0) + 1;
		const encounterBlockNumber = meta.encounterBlockIndex;
		const adventureName = (globalThis.BookUtil?.curRender?.fromIndex?.name) || meta.adventureName || "Adventure";

		const id = RendererEncounterBlock._getEncounterBlockHtmlId(entry, encounterBlockNumber);
		const dataString = renderer._renderEntriesSubtypes_getDataString(entry);

		textStack[0] += `<${renderer.wrapperTag} id="${id.qq()}" class="ve-rd__b-special ve-rd__b-inset ve-rd__b-inset--encounter ${renderer._getMutatedStyleString(entry.style || "")}" ${dataString}>`;

		const cachedLastDepthTrackerProps = MiscUtil.copyFast(renderer._lastDepthTrackerInheritedProps);
		renderer._handleTrackDepth(entry, 1);

		const pagePart = renderer._getPagePart(entry, true);
		const partExpandCollapse = !renderer._isPartPageExpandCollapseDisabled ? renderer._getPtExpandCollapseSpecial() : "";
		const partPageExpandCollapse = `<span class="ve-flex-vh-center">${[pagePart, partExpandCollapse].filter(Boolean).join("")}</span>`;

		const defaultVariant = entry.variations ? entry.variations.find(v => v.default === true) || entry.variations[0] : {};
		const DEFAULT_VARIANT_INDEX = entry.variations ? entry.variations.findIndex(v => v.variantName === defaultVariant.variantName) || 0 : 0;

		const rawDefaultPartyLevel = Number(entry.partyLevel);
		const defaultPartyLevel = Math.min(20, Math.max(1, Number.isFinite(rawDefaultPartyLevel) && rawDefaultPartyLevel > 0 ? rawDefaultPartyLevel : 3));

		const partyLevelOptionsHtml = [...Array(20)].map((_, i) => {
			const lvl = i + 1;
			return `<option value="${lvl}"${lvl === defaultPartyLevel ? " selected" : ""}>${lvl}</option>`;
		}).join("");

		const getPartyLevelSelectHtml = () => `
				<div class="encounter-party-level-select">
					<label for="${id}-party-level-select" class="encounter-party-level-select-label">Party Level</label>
					<select id="${id}-party-level-select" class="ve-form-control ve-input-xs encounter-party-level-select-input">
						${partyLevelOptionsHtml}
					</select>
				</div>`;

		textStack[0] += `<${renderer.wrapperTag} class="encounter-title">`;
		if (entry.name != null) {
			renderer._handleTrackTitles(entry.name);
			textStack[0] += `<span class="ve-rd__h ve-rd__h--2-inset" data-title-index="${renderer._headerIndex++}" ${renderer._getEnumeratedTitleRel(entry.name)}><h4 class="entry-title-inner">${entry.name}</h4>${renderer._getPagePart(entry, true)}</span>`;

			textStack[0] += `<div class="encounter-header-selects">`;
			textStack[0] += getPartyLevelSelectHtml();
			if (entry.variations?.length) {
				textStack[0] += `
				<div class="encounter-variation-select">
					<label for="${id}-variation-select" class="encounter-variation-select-label">${entry.varyBy || "Variation"}</label>
					<select id="${id}-variation-select" class="ve-form-control ve-input-xs encounter-variation-select-input">
					${entry.variations.map((v, i) => `<option value="${v.variantName || i}" ${i === DEFAULT_VARIANT_INDEX ? " selected" : ""}>${v.variantName || `Variant ${i + 1}`}</option>`).join("")}
					</select>
				</div>`;
			}
			textStack[0] += `</div>`;
		} else {
			textStack[0] += `<span class="ve-rd__h ve-rd__h--2-inset ve-rd__h--2-inset-no-name">${partPageExpandCollapse}</span>`;
			textStack[0] += `<div class="encounter-header-selects">`;
			textStack[0] += getPartyLevelSelectHtml();
			textStack[0] += `</div>`;
		}

		textStack[0] += `<div id="${id}-adj-xp" class="encounter-adj-xp">`;
		textStack[0] += `<span class="difficulty-value">Calculating...</span>`;
		textStack[0] += `</div>`;

		textStack[0] += `</${renderer.wrapperTag}>`;

		const rawEncounterSubset = entry.combatants
			? {combatants: entry.combatants, notes: entry.notes}
			: entry.variations
				? entry.variations.find(v => v.default === true) || entry.variations[0]
				: {};
		const mergedNotesArr = RendererEncounterBlock._mergeEncounterBlockNotes(entry, rawEncounterSubset);
		const encounterData = {...rawEncounterSubset, notes: mergedNotesArr};

		textStack[0] += `<${renderer.wrapperTag} id="${id}-creatures">`;
		textStack[0] += RendererEncounterBlock._renderEncounterCreatures.call(renderer, encounterData, [""], meta, options);
		textStack[0] += RendererEncounterBlock._renderEncounterNotes.call(renderer, encounterData, [""], meta, options);
		textStack[0] += `</${renderer.wrapperTag}>`;

		textStack[0] += `<div id="${id}-link-controls" class="encounter-block-link-controls-wrap"></div>`;
		textStack[0] += `</${renderer.wrapperTag}>`;

		renderer._lastDepthTrackerInheritedProps = cachedLastDepthTrackerProps;

		const block = new AdventureEncounterBlock({
			blockId: id,
			entry,
			encounterNumber: encounterBlockNumber,
			adventureName,
			defaultVariant,
		});
		AdventureEncounterBlock._blockLookup[id] = block;

		Renderer._cache.encounter ||= {};

		Renderer._cache.encounter[id] = {
			pFn: async () => {
				await block.pInit({renderer, meta, options});
			},
		};

		textStack[0] += `<style data-rd-cache-id="${id}" data-rd-cache="encounter" onload="Renderer._cache.pRunFromEle(this)"></style>`;
	}
}

const RendererEncounterBlock = {
	resetRenderState () {
		AdventureEncounterBlock._blockLookup = {};
		Renderer._cache.encounter = {};
	},

	_getEncounterBlockHtmlId (entry, encounterBlockNumber) {
		if (entry?.id) return String(entry.id);
		return `encounter-${encounterBlockNumber}`;
	},

	_getEncounterBlockEleById (blockId, suffix) {
		const ele = document.getElementById(`${blockId}${suffix}`);
		return ele ? e_({ele}) : null;
	},

	_mergeEncounterBlockNotes (entry, variationOrSubset) {
		const asArr = (n) => n == null ? [] : Array.isArray(n) ? n : [n];
		const vn = asArr(variationOrSubset?.notes);
		if (entry?.variations?.length) return [...asArr(entry?.notes), ...vn];
		return vn.length ? vn : asArr(entry?.notes);
	},

	render (entry, textStack, meta, options) {
		return AdventureEncounterBlock.pRender(this, entry, textStack, meta, options);
	},

	_renderEncounterCreatures (encounterData, textStack, meta, options) {
		const combatants = encounterData.combatants || [];
		const fauxEntry = {
			type: "list",
			style: "list-no-bullets",
			items: combatants.map(ent => {
				if (typeof ent === "string") return ent;
				if (ent.type === "item") return ent;

				const out = {...ent, type: "item"};

				if (ent.creature) {
					const creature = ent.creature;
					const qty = Number(ent.quantity) > -1 ? Number(ent.quantity) : 1;
					const npcNote = ent.npc === true ? `{@note (NPC)}` : "";
					const creatureNote = ent.note ? `{@note ${ent.note}}` : "";
					out.entry = `${qty} x ${creature} ${npcNote} ${creatureNote}`;
				}
				return out;
			}),
		};
		this._renderList(fauxEntry, textStack, meta, options);

		return textStack[0];
	},

	_renderEncounterNotes (encounterData, textStack, meta, options) {
		const notes = encounterData.notes == null ? [] : Array.isArray(encounterData.notes) ? encounterData.notes : [encounterData.notes];
		const len = notes.length;
		if (len > 0) {
			textStack[0] += `<div class="encounter-notes">`;
			textStack[0] += `<p class="encounter-notes-heading"><strong>Encounter Notes:</strong></p>`;
			textStack[0] += `<ul class="ve-rd__list ve-rd__list-no-bullets">`;
			for (let i = 0; i < len; ++i) {
				const cacheDepth = meta.depth;
				meta.depth = 2;
				this._recursiveRender(notes[i], textStack, meta, {prefix: "<p>", suffix: "</p>"});
				meta.depth = cacheDepth;
			}
			textStack[0] += `</ul>`;
			textStack[0] += `</div>`;
		}
		textStack[0] += `<hr/>`;
		textStack[0] += `<${this.wrapperTag}>Run: <a class="initiative-tracker-link" data-encounter="" href="javascript:void(0)">Initiative Tracker</a></${this.wrapperTag}>`;
		textStack[0] += `<div class="float-clear"></div>`;

		return textStack[0];
	},

	async _renderEncounterAdjXp (id, encounterData, variant, entry, meta, options, {partySize, partyLevel} = {}) {
		const combatants = encounterData.combatants || [];
		if (!combatants.length) return;

		const eleRaw = document.getElementById(id);
		if (!eleRaw) return;
		const ele = e_({ele: eleRaw});

		const avgPartyLevel = Math.min(20, Math.max(1, Number.isFinite(partyLevel) && partyLevel > 0 ? partyLevel : 3));
		const resolvedPartySize = Number(partySize) || Number(variant) || 4;

		try {
			let totalXp = 0;
			let totalNumOfMonsters = 0;
			const processedCreatures = [];
			const page = UrlUtil.PG_BESTIARY;

			await Promise.all(
				combatants.map(async function (c) {
					if (!c.hasOwnProperty("creature")) return null;
					const qty = Number(c.quantity) > -1 ? Number(c.quantity) : 1;
					const taggedNpc = c.npc === true;

					const [tagName, textArgs] = Renderer.splitFirstSpace(c.creature.slice(1, -1));
					const {name, displayText, source, hash, subhashes} = Renderer.utils.getTagMeta(tagName, textArgs);
					const baseMon = await DataLoader.pCacheAndGetHash(page, hash);
					if (!baseMon || !baseMon.name) throw Error(`Error retrieving monster ${hash} (${name}) from source ${source}.`);
					const scaledCr = subhashes?.find(item => item.key === "scaled")?.value;
					const mon = typeof scaledCr !== "undefined" ? await ScaleCreature.scale(baseMon, scaledCr) : baseMon;

					if (!taggedNpc) {
						const baseCr = mon.cr.cr || mon.cr;
						totalXp += Parser.crToXpNumber(baseCr) * qty;
						totalNumOfMonsters += qty;
					}

					for (let i = 0; i < qty; i++) {
						mon.hash = hash;
						mon.name = displayText || name;
						processedCreatures.push(mon);
					}
				}),
			).then(combatants => combatants.filter(Boolean));

			const multiplier = Parser.numMonstersToXpMult(totalNumOfMonsters);
			const adjXp = (multiplier || 1) * totalXp;

			const encounterDataOut = {
				name: entry.name || null,
				adjxp: adjXp,
				creatures: processedCreatures,
			};

			const xpThresholds = {
				easy: Parser.LEVEL_TO_XP_EASY[avgPartyLevel] * resolvedPartySize,
				medium: Parser.LEVEL_TO_XP_MEDIUM[avgPartyLevel] * resolvedPartySize,
				hard: Parser.LEVEL_TO_XP_HARD[avgPartyLevel] * resolvedPartySize,
				deadly: Parser.LEVEL_TO_XP_DEADLY[avgPartyLevel] * resolvedPartySize,
				absurd: Parser.LEVEL_TO_XP_DEADLY[avgPartyLevel] * resolvedPartySize + (Parser.LEVEL_TO_XP_DEADLY[avgPartyLevel] * resolvedPartySize - Parser.LEVEL_TO_XP_HARD[avgPartyLevel] * resolvedPartySize),
			};

			let difficultyKey;
			let difficultyText;
			xpThresholds.trivial = 0;
			if (adjXp < xpThresholds.easy) {
				difficultyKey = "trivial";
				difficultyText = "Trivial";
			} else if (adjXp < xpThresholds.medium) {
				difficultyKey = "easy";
				difficultyText = "Easy";
			} else if (adjXp < xpThresholds.hard) {
				difficultyKey = "medium";
				difficultyText = "Medium";
			} else if (adjXp < xpThresholds.deadly) {
				difficultyKey = "hard";
				difficultyText = "Hard";
			} else if (adjXp < xpThresholds.absurd) {
				difficultyKey = "deadly";
				difficultyText = "Deadly";
			} else {
				difficultyKey = "absurd";
				difficultyText = "Absurd";
			}
			let overThreshold = difficultyKey === "absurd" ? adjXp - xpThresholds.absurd : adjXp - xpThresholds[difficultyKey];
			let extraDifficulty = "";
			if (difficultyKey === "absurd") {
				const nextThreshold = xpThresholds.absurd + (xpThresholds.absurd - xpThresholds.deadly);
				const percentage = Math.round((overThreshold / (nextThreshold - xpThresholds.absurd)) * 100);
				extraDifficulty = `${percentage}%`;
			} else {
				const nextThreshold = xpThresholds[difficultyKey + 1] || xpThresholds.absurd;
				const percentage = Math.round((overThreshold / (nextThreshold - xpThresholds[difficultyKey])) * 100);
				extraDifficulty = `${percentage}%`;
			}
			const difficultyTempStack = [""];
			this._recursiveRender(
				`{@footnote ${difficultyText} ${extraDifficulty ? `+${extraDifficulty}` : ``}|
				Based on a party size of {@color ${resolvedPartySize}|--rgb-warning} player characters at level {@color ${avgPartyLevel}|--rgb-warning} fighting {@color ${totalNumOfMonsters}|--rgb-warning} hostile creatures:<br/><br/>
				{@b Difficulty}: {@color {@footnote ${difficultyText}|${_TITLE_DIFFICULTIES[difficultyKey]}|${difficultyText} Encounter} ${overThreshold > 0 ? `+{@footnote ${extraDifficulty}|This encounter's Adjusted XP is {@color ${overThreshold} xp|--rgb-warning} above, or {@color ${extraDifficulty} past|--rgb-warning}, the {@color ${difficultyText}|--rgb-warning} threshold of {@color ${xpThresholds[difficultyKey]}|--rgb-warning} for a party of {@color ${resolvedPartySize}|--rgb-warning} players at level {@color ${avgPartyLevel}|--rgb-warning}.|${extraDifficulty} beyond ${difficultyText}}` : ``}|--rgb-warning}<br/>
				{@color {@b ${difficultyText} Threshold}: ${xpThresholds[difficultyKey]}|--rgb-font--muted}<br/>
				{@color {@b Creature XP Sum}: ${totalXp}|--rgb-font--muted}<br/>
				{@color {@b Multiplier}: ×${multiplier}|--rgb-font--muted}<br/>
				{@footnote {@b Adjusted XP}|Adjusted by a multiplier of {@color ×${multiplier}|--rgb-warning}, based on a party size of {@color ${resolvedPartySize}|--rgb-warning} encountering {@color ${totalNumOfMonsters}|--rgb-warning} hostile creatures.<br/><br/>{@note Based on the {@table Encounter Multipliers; Encounter Multipliers|DMG|Encounter Multipliers} table in the {@book DMG}.}<br/><br/>|Adjusted XP}: {@color ${adjXp}|--rgb-warning}<br/>
				{@footnote {@b Daily Budget}|A rough estimate of the adjusted XP value for encounters the party can handle before the characters will need to take a long rest, based on the {@table The Adventuring Day; Adventuring Day XP|DMG|Adventuring Day XP} table in the {@book DMG}.|Daily Budget}: ${Parser.LEVEL_TO_XP_DAILY[avgPartyLevel] * resolvedPartySize}<br/>
				|Encounter Difficulty}`,
				difficultyTempStack,
				meta,
			);

			ele.find(".difficulty-value")?.html(difficultyTempStack.join(""));
			ele.find(".initiative-tracker-link")?.attr("data-encounter", JSON.stringify(encounterDataOut));
		} catch (e) {
			ele.find(".difficulty-value")?.html(`<span class="ve-text-danger">Error</span>`);
			ele.find(".initiative-tracker-link")?.html(`<span class="ve-text-danger">${e.message}</span>`);
		}
	},

	_setupEncounterHeaderControlHandlers (id, entry, defaultVariant, meta, options, block) {
		const eleRaw = document.getElementById(id);
		if (!eleRaw) return;

		RendererEncounterBlock._getEncounterBlockEleById(id, "-party-level-select")?.onChange(async () => {
			await block._controls?.pOnPartyLevelChange?.();
		});

		if (entry.variations?.length) {
			const variationSelect = RendererEncounterBlock._getEncounterBlockEleById(id, "-variation-select");
			let previousVariantName = variationSelect?.val();

			variationSelect?.onChange(async () => {
				const variantName = String(variationSelect.val());
				if (variantName === String(previousVariantName)) return;

				const outgoingVariantName = previousVariantName;
				previousVariantName = variantName;
				await block._controls?.pOnVariationChange?.({previousVariantName: outgoingVariantName});
			});
		}
	},
};

export function register () {
	globalThis.RendererEncounterBlock = RendererEncounterBlock;
}

export {
	EncounterBlockSaveManagerUtil,
	EncounterBlockBestiaryBridge,
};

register();
