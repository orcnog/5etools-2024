import {AdventureEncounterBlockSublistManager, AdventureEncounterBlockBuilderUi} from "./render-encounter-block-sublist.js";
import {EncounterBuilderCacheAdventure} from "./render-encounter-block-cache.js";
import {EncounterBuilderComponentBestiary} from "../bestiary/bestiary-encounterbuilder-component.js";
import {EncounterBuilderRulesClassic} from "../encounterbuilder/rules/encounterbuilder-rules-classic.js";
import {EncounterBuilderShapesLookup} from "../encounterbuilder/encounterbuilder-shapeslookup.js";
import {EncounterBuilderSublistPlugin} from "../bestiary/bestiary-encounterbuilder-sublistplugin.js";
import {TIER_ABSURD, TIER_DEADLY, TIER_EASY, TIER_HARD, TIER_MEDIUM, TIER_TRIVIAL, TIERS_EXTENDED} from "../encounterbuilder/consts/encounterbuilder-consts-classic.js";

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

class _EncounterBuilderStack {
	static _cache = null;
	static _encounterShapesLookup = null;

	static pGetInstance () {
		this._cache ??= new EncounterBuilderCacheAdventure();
		this._encounterShapesLookup ??= new EncounterBuilderShapesLookup();
		return {
			cache: this._cache,
			encounterShapesLookup: this._encounterShapesLookup,
		};
	}

	static pCreateBlockUi () {
		const {cache, encounterShapesLookup} = this.pGetInstance();
		const comp = new EncounterBuilderComponentBestiary({cache});
		const rulesClassic = new EncounterBuilderRulesClassic({comp, cache, encounterShapesLookup});
		comp.setActiveRulesComp(rulesClassic);

		return {
			builderUi: new AdventureEncounterBlockBuilderUi({
				cache,
				comp,
				rulesComps: [rulesClassic],
				encounterShapesLookup,
				sublistManager: null,
			}),
			comp,
			rulesClassic,
		};
	}
}

class AdventureEncounterBlockControls {
	static _STORAGE_KEY_LAST_SAVE_PREFIX = "encounterBlockLastSave_";
	static _SUB_HASH_PREFIX = "sublistselected";
	static _ENCOUNTER_BUILDER_HASH_KEY = "encounterbuilder";

	static _saveManager = null;
	static _saveManagerInitPromise = null;
	static _utilsListLoadPromise = null;

	static async _pEnsureSaveManagerLoaded () {
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

	static async pGetSaveManager () {
		await this._pEnsureSaveManagerLoaded();

		if (this._saveManager) return this._saveManager;

		this._saveManagerInitPromise ||= (async () => {
			const saveManager = new SaveManager({page: UrlUtil.PG_BESTIARY});
			await saveManager.pMutStateFromStorage();
			this._saveManager = saveManager;
		})();

		await this._saveManagerInitPromise;
		return this._saveManager;
	}

	constructor ({block}) {
		this._block = block;

		this._blockStorageKey = this._getBlockStorageKey();

		this._activeState = {
			name: null,
		};
		this._storedUserState = null;
		this._isSkipAutoPersist = false;
		this._pAutoPersistUserStateDebounced = MiscUtil.debounce(this._pAutoPersistUserState.bind(this), VeCt.DUR_DEBOUNCE_SAVE);

		this._eleRoot = null;
		this._iptName = null;
		this._btnReload = null;
		this._btnCopyJson = null;
		this._dispCount = null;
	}

	_getBlockStorageKey () {
		return this.constructor.getBlockStorageKey(this._block);
	}

	static getBlockStorageKey (block) {
		const idPart = block._entry.id || `encounter-${block._encounterNumber}`;
		const advPart = (block._adventureName || "adventure").toUrlified();
		return `${this._STORAGE_KEY_LAST_SAVE_PREFIX}${advPart}_${idPart.toUrlified()}`;
	}

	static mutMigrateStoredUserState (stored) {
		if (!stored) return null;

		if (stored.variants || stored.selectedVariantName != null) {
			stored.variants = stored.variants || {};
			return stored;
		}

		if (stored.exportedSublist) {
			const variantKey = stored.exportedSublist.adventureBlockState?.variantName != null
				? String(stored.exportedSublist.adventureBlockState.variantName)
				: "_default";

			return {
				selectedVariantName: variantKey === "_default" ? null : variantKey,
				variants: {
					[variantKey]: {
						exportedSublist: stored.exportedSublist,
						name: stored.name ?? null,
					},
				},
			};
		}

		return null;
	}

	async pInit ({ele}) {
		this._eleRoot = e_({ele});
		this._storedUserState = this.constructor.mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey));
		await this._renderUi();
		await this._pRestoreFromStorage();
	}

	async _pRestoreFromStorage () {
		if (!this._storedUserState) return;

		this._isSkipAutoPersist = true;
		this._cancelScheduledAutoPersist();
		try {
			const selectedVariantName = this._getStoredSelectedVariantName();
			if (selectedVariantName != null) {
				this._block._pSetVariationSelectValue(selectedVariantName);
			}

			const variantEntry = this._getStoredVariantEntry(this._storedUserState, this._getVariantStorageKey());

			if (variantEntry?.exportedSublist) {
				await this._block.pApplyFromExportableSublist(variantEntry.exportedSublist);
				this._activeState.name = variantEntry.name || null;
			} else if (this._block._entry.variations?.length) {
				this._activeState.name = null;
				await this._block.pReloadFromAdventureJson({isPersist: false});
			}

			this._updateNameDisplay();
			this._updateModifiedBtns();
		} finally {
			this._cancelScheduledAutoPersist();
			this._isSkipAutoPersist = false;
		}
	}

	pScheduleAutoPersist () {
		if (this._isSkipAutoPersist) return;
		this._pAutoPersistUserStateDebounced();
	}

	_cancelScheduledAutoPersist () {
		this._pAutoPersistUserStateDebounced.cancel();
	}

	pUpdateDisplay () {
		this._updateCountDisplay();
		this._updateNameDisplay();
		this._updateModifiedBtns();
	}

	_getVariantStorageKey (variantName = null) {
		if (!this._block._entry.variations?.length) return "_default";
		return String(variantName ?? this._block._getSelectedVariantName());
	}

	_getStoredSelectedVariantName () {
		const stored = this.constructor.mutMigrateStoredUserState(this._storedUserState);
		if (stored?.selectedVariantName == null) return null;
		return String(stored.selectedVariantName);
	}

	_mutMigrateStoredUserState (stored) {
		return this.constructor.mutMigrateStoredUserState(stored);
	}

	_getStoredVariantEntry (stored, variantKey) {
		stored = this._mutMigrateStoredUserState(stored);
		return stored?.variants?.[variantKey] ?? null;
	}

	async _pPersistUserStateToStorage ({exportedSublist, variantKey = null, name = null} = {}) {
		const stored = this._mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey)) ?? {variants: {}};
		variantKey = variantKey ?? this._getVariantStorageKey();

		stored.variants[variantKey] = {
			exportedSublist: MiscUtil.copyFast(exportedSublist),
			name: name ?? this._activeState.name,
		};

		if (this._block._entry.variations?.length) {
			stored.selectedVariantName = String(this._block._getSelectedVariantName());
		}

		this._storedUserState = stored;
		await StorageUtil.pSet(this._blockStorageKey, stored);
	}

	async pPersistSelectedVariantName ({isForce = false} = {}) {
		if (!isForce && this._isSkipAutoPersist) return;
		if (!this._block._entry.variations?.length) return;

		const stored = this.constructor.mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey)) ?? {variants: {}};
		stored.selectedVariantName = String(this._block._getSelectedVariantName());
		this._storedUserState = stored;
		await StorageUtil.pSet(this._blockStorageKey, stored);
	}

	async pPersistVariantStateNow ({variantKey = null} = {}) {
		if (this._isSkipAutoPersist || !this._block._sublistManager) return;

		variantKey = variantKey ?? this._getVariantStorageKey();
		const variantName = variantKey === "_default" ? null : variantKey;
		const exportedSublist = this._getExportableSublistForStorage(await this._pBuildExportableSublist({variantName}));

		await this._pPersistUserStateToStorage({
			exportedSublist,
			variantKey,
			name: this._activeState.name,
		});
	}

	async pPurgeVariantStateFromStorage ({variantKey = null} = {}) {
		variantKey = variantKey ?? this._getVariantStorageKey();

		let stored = this._mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey));
		if (stored?.variants?.[variantKey]) delete stored.variants[variantKey];

		if (this._storedUserState?.variants?.[variantKey]) delete this._storedUserState.variants[variantKey];

		if (!stored?.variants || !Object.keys(stored.variants).length) {
			const hasSelectedVariant = this._block._entry.variations?.length && stored?.selectedVariantName != null;

			if (!hasSelectedVariant) {
				await StorageUtil.pRemove(this._blockStorageKey);
				this._storedUserState = null;
				this._cancelScheduledAutoPersist();
				return;
			}

			stored = {
				selectedVariantName: stored.selectedVariantName,
				variants: {},
			};
		}

		this._storedUserState = stored;
		await StorageUtil.pSet(this._blockStorageKey, stored);
		this._cancelScheduledAutoPersist();
	}

	async _pAutoPersistUserState () {
		if (this._isSkipAutoPersist || !this._block._sublistManager) return;

		const exportedSublist = this._getExportableSublistForStorage(await this._pBuildExportableSublist());
		await this._pPersistUserStateToStorage({exportedSublist});
	}

	_getExportableSublistForStorage (exportedSublist) {
		if (!exportedSublist) return exportedSublist;

		const cpy = MiscUtil.copyFast(exportedSublist);
		Object.keys(cpy)
			.filter(k => k.startsWith("manager_") || k.startsWith("managerClient_"))
			.forEach(k => delete cpy[k]);

		return cpy;
	}

	async pConfirmDestructiveOverwrite ({
		title = "Discard Unsaved Changes",
		htmlDescription = "You have unsaved changes.<br>Are you sure you want to continue? Any unsaved changes will be lost.",
		textYes = "Continue",
		textNo = "Cancel",
	} = {}) {
		if (!await this._pHasDestructiveOverwrite()) return true;

		return InputUiUtil.pGetUserBoolean({title, htmlDescription, textYes, textNo});
	}

	async _pHasDestructiveOverwrite () {
		if (await this._pHasStoredVariantState()) return true;
		return this._block.pIsChangedFromOriginal();
	}

	async _pHasStoredVariantState () {
		const stored = this._storedUserState ?? this._mutMigrateStoredUserState(await StorageUtil.pGet(this._blockStorageKey));
		return !!this._getStoredVariantEntry(stored, this._getVariantStorageKey())?.exportedSublist;
	}

	_getAutoSaveName () {
		return `${this._block._adventureName}: ${this._block._getEncounterDisplayName()} (${this._block._getPartySize()}P)`;
	}

	async _pGetEncounterBlockJsonForCopy () {
		const entry = this._block._entry;
		const stored = this._mutMigrateStoredUserState(
			this._storedUserState ?? await StorageUtil.pGet(this._blockStorageKey),
		);
		const currentVariantKey = this._getVariantStorageKey();
		const out = MiscUtil.copyFast(entry);

		if (entry.variations?.length) {
			out.variations = await entry.variations.pSerialAwaitMap(async variation => {
				const variantKey = String(variation.variantName);
				const variationOut = MiscUtil.copyFast(variation);
				variationOut.combatants = await this._pGetCombatantsForVariantExport({
					variantKey,
					variation,
					stored,
					isCurrent: variantKey === currentVariantKey,
				});
				return variationOut;
			});
			delete out.combatants;
		} else {
			out.combatants = await this._pGetCombatantsForVariantExport({
				variantKey: "_default",
				variation: entry,
				stored,
				isCurrent: true,
			});
		}

		return out;
	}

	async _pGetCombatantsForVariantExport ({variantKey, variation, stored, isCurrent}) {
		if (isCurrent) {
			return this._block._sublistManager?.getCombatantsFromSublist?.()
				|| MiscUtil.copyFast(variation?.combatants || []);
		}

		const variantEntry = this._getStoredVariantEntry(stored, variantKey);
		if (variantEntry?.exportedSublist?.items?.length) {
			return AdventureEncounterBlockSublistManager.pGetCombatantsFromExportedSublist(
				variantEntry.exportedSublist,
			);
		}

		return MiscUtil.copyFast(variation?.combatants || []);
	}

	async _pBuildExportableSublist ({variantName = null} = {}) {
		this._block._sublistManager?.pCommitPendingEdits?.();
		const exported = await this._block._sublistManager.pGetExportableEncounterSublist();
		variantName = variantName ?? this._block._getSelectedVariantName();
		const partyLevel = this._block._getPartyLevel();
		const partySize = this._block._getPartySize(variantName);

		exported.playersSimple = [{count: partySize, level: partyLevel}];
		exported.isAdvanced = false;
		exported.colsExtraAdvanced = exported.colsExtraAdvanced || [];
		exported.playersAdvanced = exported.playersAdvanced || [];
		exported.customShapeGroups = exported.customShapeGroups || [];
		exported.adventureBlockState = {
			partyLevel,
			variantName,
			blockId: this._block._entry.id || null,
		};

		return exported;
	}

	async _pGetBestiaryEbUrl () {
		const exportable = await this._pBuildExportableSublist();
		if (this._activeState.name) exportable.name = this._activeState.name;

		const hashParts = [
			HASH_BLANK,
			UrlUtil.packSubHash(this.constructor._ENCOUNTER_BUILDER_HASH_KEY, ["true"]),
			UrlUtil.packSubHash(this.constructor._SUB_HASH_PREFIX, [JSON.stringify(exportable)], {isEncodeBoth: true}),
		];

		return `${UrlUtil.link(UrlUtil.PG_BESTIARY)}#${hashParts.join(HASH_PART_SEP)}`;
	}

	_getCopyJsonBtnTitle () {
		const entry = this._block._entry;
		if (!entry.variations?.length) return "Copy encounter block JSON";
		return "Copy encounter block JSON (all variations, including saved tweaks)";
	}

	_updateCopyJsonBtnTitle () {
		if (!this._btnCopyJson) return;
		this._btnCopyJson.attr("title", this._getCopyJsonBtnTitle());
	}

	_updateModifiedBtns () {
		if (!this._btnReload || !this._btnCopyJson) return;

		this._updateCopyJsonBtnTitle();

		this._block.pIsChangedFromOriginal()
			.then(isChanged => {
				this._btnReload.prop("disabled", !isChanged);
				this._btnCopyJson.toggleClass("encounter-block-controls__btn-copy--active", isChanged);
			});
	}

	_replacePartySizeSuffix (name, partySize) {
		return name.replace(/\(\d+P\)(?![\s\S]*\(\d+P\))/, `(${partySize}P)`);
	}

	_updateNameDisplay () {
		if (!this._iptName) return;

		const autoName = this._getAutoSaveName();
		const partySize = this._block._getPartySize();

		if (this._activeState.name) {
			const updated = this._replacePartySizeSuffix(this._activeState.name, partySize);
			if (updated !== this._activeState.name) this._activeState.name = updated;
			this._iptName.val(this._activeState.name);
			return;
		}

		this._iptName.val(autoName);
	}

	_updateCountDisplay () {
		if (!this._dispCount) return;
		const cnt = (this._block._sublistManager?.sublistItems || [])
			.map(it => Number(it.data.count) || 0)
			.sum();
		this._dispCount.html(`<span class="glyphicon glyphicon-pushpin ve-mr-1"></span> ${cnt}`);
	}

	_bindControlChangeHooks () {
		this._block._getBlockEle("-party-level-select")?.onChange(() => {
			this._updateCountDisplay();
			this._updateNameDisplay();
		});
		this._block._getBlockEle("-variation-select")?.onChange(() => {
			this._updateCountDisplay();
			this._updateNameDisplay();
			this._updateCopyJsonBtnTitle();
		});
	}

	_bindListNameHandlers () {
		if (!this._iptName) return;

		this._iptName
			.onn("mousedown", evt => evt.stopPropagation())
			.onn("click", evt => {
				evt.stopPropagation();
				if (this._iptName.readOnly) {
					this._iptName.attr("readonly", false);
					this._iptName.focus();
					this._iptName.select();
				}
			})
			.onn("focus", () => this._iptName.attr("readonly", false))
			.onn("blur", () => {
				this._iptName.attr("readonly", true);
				const autoName = this._getAutoSaveName();
				const val = this._iptName.val().trim() || autoName;
				this._activeState.name = val === autoName ? null : val;
				this._updateNameDisplay();
				this.pScheduleAutoPersist();
			})
			.onn("keydown", evt => {
				if (evt.key === "Enter") this._iptName.blur();
			});
	}

	async _renderUi () {
		this._eleRoot.empty();

		this._iptName = ee`<input class="ve-form-control ve-input-xs ve-w-100" readonly>`;
		this._dispCount = ee`<div class="ve-absolute ve-right-0 ve-z-index-1 ve-no-events ve-flex-vh-center ve-muted ve-pr-2 ve-small" title="Number of Pinned List Items"></div>`;

		const btnSave = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Save as Pinned List"><span class="glyphicon glyphicon-floppy-disk"></span></button>`
			.onn("click", evt => this._pHandleSave(evt));

		const btnLoad = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Load Pinned List"><span class="glyphicon glyphicon-folder-open"></span></button>`
			.onn("click", evt => this._pHandleLoad(evt));

		const btnDownload = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Download Pinned List"><span class="glyphicon glyphicon-download"></span></button>`
			.onn("click", evt => this._pHandleDownload(evt));

		const btnUpload = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Upload Pinned List"><span class="glyphicon glyphicon-upload"></span></button>`
			.onn("click", evt => this._pHandleUpload(evt));

		const btnEditPinnedList = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Edit Pinned List in Encounter Builder"><span class="glyphicon glyphicon-pencil"></span></button>`
			.onn("click", evt => this._pHandleEditPinnedList(evt));

		this._btnReload = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default" title="Restore Original Encounter" disabled><span class="glyphicon glyphicon-refresh"></span></button>`
			.onn("click", evt => this._pHandleReload(evt));

		this._btnCopyJson = ee`<button class="ve-btn ve-btn-5et ve-btn-xs ve-btn-default encounter-block-controls__btn-copy" title="${this._getCopyJsonBtnTitle()}"><span class="glyphicon glyphicon-copy"></span></button>`
			.onn("click", evt => this._pHandleCopyJson(evt));

		ee(this._eleRoot)`
			<div class="ve-flex-col ve-my-2 ve-w-100 encounter-block-controls__summary">
				<div class="ve-flex-v-center">
					<div class="ve-flex-v-center ve-mr-1 ve-w-100 ve-min-w-0 ve-relative">
						<div class="ve-mr-2 ve-muted">List:</div>
						${this._iptName}
						${this._dispCount}
					</div>
					<div class="ve-flex-h-right ve-flex-v-center ve-btn-group ve-no-shrink">
						${btnSave}
						${btnLoad}
						${btnDownload}
						${btnUpload}
						${btnEditPinnedList}
						${this._btnReload}
						${this._btnCopyJson}
					</div>
				</div>
			</div>`;

		this._updateNameDisplay();
		this._updateCountDisplay();
		this._updateModifiedBtns();
		this._bindControlChangeHooks();
		this._bindListNameHandlers();
	}

	async _pHandleNew (evt) {
		if (evt.shiftKey) {
			await this._block.pResetToDefaults();
		}

		this._activeState.name = null;
		this._updateNameDisplay();
		this._updateModifiedBtns();
		this.pScheduleAutoPersist();
	}

	async _pHandleDuplicate (evt) {
		const baseName = this._activeState.name || this._getAutoSaveName();
		let nextName = baseName;

		const mSuffix = /(?<prefix> \()(?<num>\d+)(?<suffix>\)\s*)$/i.exec(baseName);
		if (mSuffix) {
			nextName = baseName.replace(/(?<prefix> \()(?<num>\d+)(?<suffix>\)\s*)$/i, (...m) => {
				return `${m.last().prefix}${Number(m.last().num) + 1}${m.last().suffix}`;
			});
		} else {
			nextName = `${baseName} (1)`;
		}

		this._activeState.name = nextName;
		this._updateNameDisplay();
		this._updateModifiedBtns();
		this.pScheduleAutoPersist();
	}

	async _pHandleSave (evt) {
		const saveManager = await this.constructor.pGetSaveManager();
		await saveManager.pDoNew(null);

		const exportable = await this._pBuildExportableSublist();
		exportable.name = this._activeState.name || this._getAutoSaveName();

		const saveInfo = await saveManager.pDoSave(exportable);
		if (!saveInfo) return;

		this._activeState.name = saveInfo.name;

		this._updateNameDisplay();
		this._updateModifiedBtns();
		await this._block._pCaptureSavedSnapshot();
		this.pScheduleAutoPersist();
		JqueryUtil.doToast(`Saved "${saveInfo.name}"!`);
	}

	async _pHandleLoad (evt) {
		if (!await this.pConfirmDestructiveOverwrite({
			title: "Load Pinned List",
			htmlDescription: "Are you sure you want to load a pinned list? This will replace the stored state for this encounter variant.",
			textYes: "Load",
		})) return;

		const saveManager = await this.constructor.pGetSaveManager();
		const exportedSublist = await saveManager.pDoLoad();
		if (!exportedSublist) return;

		await this._block.pApplyFromExportableSublist(exportedSublist);

		this._activeState.name = exportedSublist.name || null;

		this._updateNameDisplay();
		this._updateModifiedBtns();
		this.pScheduleAutoPersist();
	}

	async _pHandleDownload (evt) {
		const exportable = await this._pBuildExportableSublist();
		if (this._activeState.name) exportable.name = this._activeState.name;

		DataUtil.userDownload(
			"encounter",
			ListUtil.getWithoutManagerState(exportable),
			{fileType: "encounter"},
		);
	}

	async _pHandleEditPinnedList (evt) {
		const url = await this._pGetBestiaryEbUrl();
		window.open(url, "_blank", "noopener,noreferrer");
	}

	async _pHandleUpload (evt) {
		if (!await this.pConfirmDestructiveOverwrite({
			title: "Upload Pinned List",
			htmlDescription: "Are you sure you want to upload a pinned list? This will replace the stored state for this encounter variant.",
			textYes: "Upload",
		})) return;

		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({
			expectedFileTypes: ["encounter", "bestiary-sublist"],
		});

		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;

		const json = jsons[0];
		await EncounterBuilderSublistPlugin.pMutLegacyData({exportedSublist: json});

		await this._block.pApplyFromExportableSublist(json);

		this._activeState.name = json.name || null;
		this._updateNameDisplay();
		this._updateModifiedBtns();
		this.pScheduleAutoPersist();
	}

	async _pHandleReload (evt) {
		if (this._btnReload?.prop("disabled")) return;

		if (!await this.pConfirmDestructiveOverwrite({
			title: "Restore Original Encounter",
			htmlDescription: "Are you sure you want to restore the original encounter? This will replace the stored state for this encounter variant.",
			textYes: "Restore",
		})) return;

		this._activeState.name = null;

		this._isSkipAutoPersist = true;
		this._cancelScheduledAutoPersist();
		try {
			await this._block.pReloadFromAdventureJson({isPersist: false});
			await this.pPurgeVariantStateFromStorage();
			this._updateNameDisplay();
			this._updateModifiedBtns();
		} finally {
			this._cancelScheduledAutoPersist();
			this._isSkipAutoPersist = false;
		}
	}

	async _pHandleCopyJson (evt) {
		const btn = this._btnCopyJson;
		const json = JSON.stringify(await this._pGetEncounterBlockJsonForCopy(), null, "\t");
		await MiscUtil.pCopyTextToClipboard(json);
		JqueryUtil.showCopiedEffect(btn);
	}
}

class AdventureEncounterBlock {
	static _blockLookup = {};

	constructor ({
		blockId,
		entry,
		encounterNumber,
		adventureName,
		defaultVariant,
		initialEncounterData,
	}) {
		this._blockId = blockId;
		this._entry = entry;
		this._encounterNumber = encounterNumber;
		this._adventureName = adventureName || "Adventure";
		this._defaultVariant = defaultVariant || {};
		this._initialEncounterData = initialEncounterData;

		this._renderer = null;
		this._meta = null;
		this._options = null;

		this._builderUi = null;
		this._comp = null;
		this._rulesClassic = null;
		this._sublistManager = null;
		this._controls = null;

		this._isApplyingExport = false;
		this._baselineItemsSnapshot = null;
		this._savedItemsSnapshot = null;
	}

	_getBlockEle (suffix = "") {
		return RendererEncounterBlock._getEncounterBlockEleById(this._blockId, suffix);
	}

	_getBlockStorageKey () {
		return AdventureEncounterBlockControls.getBlockStorageKey(this);
	}

	_pSetVariationSelectValue (selectedVariantName) {
		const ele = document.getElementById(`${this._blockId}-variation-select`);
		if (!ele || selectedVariantName == null) return false;

		const target = String(selectedVariantName);
		if (![...ele.options].some(opt => String(opt.value) === target)) return false;

		ele.value = target;
		return true;
	}

	async _pRestoreSelectedVariantFromStorage () {
		if (!this._entry.variations?.length) return null;

		const stored = AdventureEncounterBlockControls.mutMigrateStoredUserState(
			await StorageUtil.pGet(this._getBlockStorageKey()),
		);
		if (stored?.selectedVariantName == null) return null;

		const selectedVariantName = String(stored.selectedVariantName);
		this._pSetVariationSelectValue(selectedVariantName);
		return selectedVariantName;
	}

	_getDefaultVariant () {
		if (!this._entry.variations?.length) return {};
		return this._entry.variations.find(v => v.default === true) || this._entry.variations[0];
	}

	_getSelectedVariantName () {
		const variationSelect = this._getBlockEle("-variation-select");
		if (variationSelect) return variationSelect.val();
		return this._getDefaultVariant().variantName ?? null;
	}

	_getSelectedVariation () {
		if (!this._entry.variations?.length) return null;
		const variantName = this._getSelectedVariantName();
		return this._entry.variations.find(v => String(v.variantName) === String(variantName))
			|| this._getDefaultVariant();
	}

	_getEncounterDataForCurrentSelection () {
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

	_getEncounterDisplayName () {
		if (this._entry.name) return this._entry.name;
		return `Encounter ${this._encounterNumber}`;
	}

	_getPartyLevel () {
		const partyLevelSelect = this._getBlockEle("-party-level-select");
		const rawLevel = partyLevelSelect ? Number(partyLevelSelect.val()) : Number(this._entry.partyLevel);
		return Math.min(20, Math.max(1, Number.isFinite(rawLevel) && rawLevel > 0 ? rawLevel : 3));
	}

	_getPartySize (variantName = null) {
		variantName = variantName ?? this._getSelectedVariantName();
		if (this._entry.variations?.length && _PARTY_SIZE_VARY_BY_RE.test(this._entry.varyBy || "")) {
			const n = Number(variantName);
			if (Number.isFinite(n) && n > 0) return n;
		}
		if (variantName != null && !Number.isNaN(Number(variantName)) && Number(variantName) > 0) return Number(variantName);
		return 4;
	}

	_syncCompPartyFromControls () {
		this._comp.playersSimple = [
			EncounterBuilderComponentBestiary.getDefaultPlayerRow_simple({
				count: this._getPartySize(),
				level: this._getPartyLevel(),
			}),
		];
		this._comp.pulseDerivedPartyMeta();
	}

	_renderNotes () {
		const encounterData = this._getEncounterDataForCurrentSelection();
		const notesHtml = RendererEncounterBlock._renderEncounterNotes.call(
			this._renderer,
			encounterData,
			[""],
			this._meta,
			this._options,
		);
		this._getBlockEle("-notes-content")?.html(notesHtml);
	}

	onSublistChange () {
		this._syncCompPartyFromControls();
		this._controls?.pUpdateDisplay?.();
		this._controls?.pScheduleAutoPersist?.();
		this.pUpdateXpAndInitiative().then(null);
	}

	async _getComparableItemsSnapshot () {
		this._sublistManager?.pCommitPendingEdits?.();
		const exported = await this._sublistManager.pGetExportableEncounterSublist();
		return (exported.items || [])
			.map(it => ({
				h: it.h,
				c: `${Number(it.c) || 1}`,
				...(it.customHashId ? {customHashId: it.customHashId} : {}),
				...(it.l ? {l: true} : {}),
				...(it.dn ? {dn: it.dn} : {}),
				...(it.n ? {n: it.n} : {}),
			}))
			.sort((a, b) => SortUtil.ascSortLower(a.h, b.h) || SortUtil.ascSortLower(a.customHashId || "", b.customHashId || ""));
	}

	async _pCaptureBaseline () {
		this._baselineItemsSnapshot = await this._getComparableItemsSnapshot();
	}

	async _getComparableSavedStateSnapshot () {
		return {
			partyLevel: this._getPartyLevel(),
			variantName: this._getSelectedVariantName(),
			items: await this._getComparableItemsSnapshot(),
		};
	}

	async _pCaptureSavedSnapshot () {
		this._savedItemsSnapshot = await this._getComparableSavedStateSnapshot();
	}

	async pHasUnsavedChanges () {
		if (!this._savedItemsSnapshot || !this._sublistManager) return false;

		const current = await this._getComparableSavedStateSnapshot();
		const saved = {
			partyLevel: this._savedItemsSnapshot.partyLevel,
			items: this._savedItemsSnapshot.items,
		};
		const cur = {
			partyLevel: current.partyLevel,
			items: current.items,
		};
		return !CollectionUtil.deepEquals(saved, cur);
	}

	async pIsChangedFromOriginal () {
		if (!this._baselineItemsSnapshot || !this._sublistManager) return false;
		const current = await this._getComparableItemsSnapshot();
		return !CollectionUtil.deepEquals(this._baselineItemsSnapshot, current);
	}

	async pReloadFromAdventureJson ({isPersist = true} = {}) {
		const encounterData = this._getEncounterDataForCurrentSelection();
		await this._sublistManager.pPopulateFromCombatants({combatants: encounterData.combatants});
		this._syncCompPartyFromControls();
		this._renderNotes();
		await this._pCaptureBaseline();
		this._controls?.pUpdateDisplay?.();
		await this.pUpdateXpAndInitiative();
		if (isPersist) this._controls?.pScheduleAutoPersist?.();
	}

	async pResetToDefaults () {
		const rawDefaultPartyLevel = Number(this._entry.partyLevel);
		const defaultPartyLevel = Math.min(20, Math.max(1, Number.isFinite(rawDefaultPartyLevel) && rawDefaultPartyLevel > 0 ? rawDefaultPartyLevel : 3));
		this._getBlockEle("-party-level-select")?.val(String(defaultPartyLevel));

		const defaultVariant = this._getDefaultVariant();
		if (defaultVariant?.variantName != null) {
			this._getBlockEle("-variation-select")?.val(String(defaultVariant.variantName));
		}

		await this.pReloadFromAdventureJson();
	}

	async pApplyFromExportableSublist (exportedSublist) {
		if (!exportedSublist || !this._sublistManager) return;

		this._isApplyingExport = true;
		try {
			const partyLevel = exportedSublist.adventureBlockState?.partyLevel
				?? exportedSublist.playersSimple?.[0]?.level;
			if (partyLevel != null) {
				this._getBlockEle("-party-level-select")?.val(String(partyLevel));
			}

			const variantName = exportedSublist.adventureBlockState?.variantName;
			if (variantName != null && this._entry.variations?.length) {
				this._pSetVariationSelectValue(variantName);
			}

			if (exportedSublist.items?.length) {
				await this._sublistManager.pDoLoadExportedSublist(exportedSublist);
			} else {
				const encounterData = this._getEncounterDataForCurrentSelection();
				await this._sublistManager.pPopulateFromCombatants({combatants: encounterData.combatants});
			}

			this._syncCompPartyFromControls();
			this._renderNotes();
			this._controls?.pUpdateDisplay?.();
			await this.pUpdateXpAndInitiative();
			await this._pCaptureSavedSnapshot();
		} finally {
			this._isApplyingExport = false;
		}
	}

	async pOnPartyLevelChange () {
		this._syncCompPartyFromControls();
		this._controls?.pUpdateDisplay?.();
		await this.pUpdateXpAndInitiative();
		this._controls?.pScheduleAutoPersist?.();
	}

	async pOnVariationChange () {
		if (this._isApplyingExport) return;

		const variantKey = this._controls._getVariantStorageKey();
		const variantEntry = this._controls._getStoredVariantEntry(this._controls._storedUserState, variantKey);

		this._controls._isSkipAutoPersist = true;
		try {
			if (variantEntry?.exportedSublist) {
				await this.pApplyFromExportableSublist(variantEntry.exportedSublist);
				this._controls._activeState.name = variantEntry.name ?? null;
			} else {
				this._controls._activeState.name = null;
				await this.pReloadFromAdventureJson({isPersist: false});
			}

			this._controls._updateNameDisplay();
			this._controls._updateModifiedBtns();
		} finally {
			this._controls._isSkipAutoPersist = false;
		}

		await this._controls.pPersistSelectedVariantName({isForce: true});
	}

	async pUpdateXpAndInitiative () {
		await RendererEncounterBlock._renderEncounterAdjXp.call(
			this._renderer,
			this._blockId,
			this._comp,
			this._rulesClassic,
			this._entry,
			this._meta,
			this._options,
			{
				partySize: this._getPartySize(),
				partyLevel: this._getPartyLevel(),
				displayName: this._getEncounterDisplayName(),
				block: this,
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

		const wrpListRaw = document.getElementById(`${this._blockId}-sublist`);
		if (!wrpListRaw) return;

		const stack = _EncounterBuilderStack.pGetInstance();
		await stack.cache.pEnsureCaches();

		const {builderUi, comp, rulesClassic} = _EncounterBuilderStack.pCreateBlockUi();
		this._builderUi = builderUi;
		this._comp = comp;
		this._rulesClassic = rulesClassic;

		this._sublistManager = new AdventureEncounterBlockSublistManager({
			wrpList: wrpListRaw,
			encounterBuilderUi: builderUi,
		});
		builderUi._sublistManager = this._sublistManager;
		builderUi.setBlock(this);

		const sublistPlugin = new EncounterBuilderSublistPlugin({
			sublistManager: this._sublistManager,
			encounterBuilder: builderUi,
			encounterBuilderComp: comp,
		});
		this._sublistManager.addPlugin(sublistPlugin);

		await this._sublistManager.pInitSublist();

		await this._pRestoreSelectedVariantFromStorage();

		const encounterData = this._getEncounterDataForCurrentSelection();
		await this._sublistManager.pPopulateFromCombatants({
			combatants: encounterData.combatants || [],
		});
		await this._pCaptureBaseline();
		await this._pCaptureSavedSnapshot();
		this._syncCompPartyFromControls();

		await this.pUpdateXpAndInitiative();

		const controlsEle = document.getElementById(`${this._blockId}-controls`);
		if (controlsEle) {
			this._controls = new AdventureEncounterBlockControls({block: this});
			await this._controls.pInit({ele: controlsEle});
		}

		this._setupHeaderControlHandlers();
		await this.pUpdateXpAndInitiative();
	}

	static pRender (renderer, entry, textStack, meta, options) {
		if (!entry?.combatants?.length && (!entry?.variations?.length || entry.variations.every(v => v?.combatants?.length <= 0))) return;

		meta.encounterBlockIndex = (meta.encounterBlockIndex ?? 0) + 1;
		const encounterBlockNumber = meta.encounterBlockIndex;
		const adventureName = (globalThis.BookUtil?.curRender?.fromIndex?.name) || meta.adventureName || "Adventure";

		const id = CryptUtil.uid();

		const dataString = renderer._renderEntriesSubtypes_getDataString(entry);

		textStack[0] += `<${renderer.wrapperTag} id="${id}" class="ve-rd__b-special ve-rd__b-inset ve-rd__b-inset--encounter encounter-block--ecgen ${renderer._getMutatedStyleString(entry.style || "")}" ${dataString}>`;

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
			if (Renderer.ENTRIES_WITH_ENUMERATED_TITLES_LOOKUP[entry.type]) renderer._handleTrackTitles(entry.name);
			textStack[0] += `<span class="ve-rd__h ve-rd__h--2-inset" data-title-index="${renderer._headerIndex++}" ${renderer._getEnumeratedTitleRel(entry.name)}><h4 class="entry-title-inner">${entry.name}</h4>${renderer._getPagePart(entry, true)}</span>`;

			textStack[0] += `<div class="encounter-header-selects">`;
			textStack[0] += getPartyLevelSelectHtml();
			if (entry.variations?.length) {
				textStack[0] += `
				<div class="encounter-variation-select">
					<label for="${id}-variation-select" class="encounter-variation-select-label">${entry.varyBy || "Variation"}</label>
					<select id="${id}-variation-select" class="ve-form-control ve-input-xs encounter-variation-select-input">
					${entry.variations.map((v, i) => `<option value="${v.variantName || i}" ${i === DEFAULT_VARIANT_INDEX ? "selected" : ""}>${v.variantName || `Variant ${i + 1}`}</option>`).join("")}
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
		textStack[0] += `<div class="sublist sublist--visible encounter-block-sublist-wrap no-print">`;
		textStack[0] += `<div id="${id}-sublistsort" class="encounter-block-sublist__grid encounter-block-sublist__header">`;
		textStack[0] += `<span class="encounter-block-sublist__col encounter-block-sublist__col--btns-hdr encounter-block-sublist__col--btns ve-no-wrap ve-btn-group" aria-hidden="true">`;
		textStack[0] += `<button type="button" class="ve-btn ve-btn-success ve-btn-xs best-ecgen__btn-list" disabled tabindex="-1"><span class="glyphicon glyphicon-plus"></span></button>`;
		textStack[0] += `<button type="button" class="ve-btn ve-btn-danger ve-btn-xs best-ecgen__btn-list" disabled tabindex="-1"><span class="glyphicon glyphicon-minus"></span></button>`;
		textStack[0] += `</span>`;
		textStack[0] += `<span class="encounter-block-sublist__col encounter-block-sublist__col--name-hdr sort" data-sort="name"><strong>Name</strong></span>`;
		textStack[0] += `<span class="encounter-block-sublist__col encounter-block-sublist__col--cr sort" data-sort="cr"><strong>CR</strong></span>`;
		textStack[0] += `<span class="encounter-block-sublist__col encounter-block-sublist__col--num sort" data-sort="count"><strong>Number</strong></span>`;
		textStack[0] += `<span class="encounter-block-sublist__col encounter-block-sublist__col--notes"><strong>Notes</strong></span>`;
		textStack[0] += `</div>`;
		textStack[0] += `<div id="${id}-sublist" class="list encounter-block-sublist"></div>`;
		textStack[0] += `</div>`;
		textStack[0] += `<div id="${id}-controls" class="encounter-block-controls no-print"></div>`;
		textStack[0] += `<div id="${id}-notes-content" class="encounter-block-notes">`;
		textStack[0] += RendererEncounterBlock._renderEncounterNotes.call(renderer, encounterData, [""], meta, options);
		textStack[0] += `</div>`;
		textStack[0] += `<hr/>`;
		textStack[0] += `<${renderer.wrapperTag}>Run: <a class="initiative-tracker-link" data-encounter="" href="javascript:void(0)">Initiative Tracker</a></${renderer.wrapperTag}>`;
		textStack[0] += `<div class="float-clear"></div>`;
		textStack[0] += `</${renderer.wrapperTag}>`;
		textStack[0] += `</${renderer.wrapperTag}>`;

		renderer._lastDepthTrackerInheritedProps = cachedLastDepthTrackerProps;

		const block = new AdventureEncounterBlock({
			blockId: id,
			entry,
			encounterNumber: encounterBlockNumber,
			adventureName,
			defaultVariant,
			initialEncounterData: encounterData,
		});
		AdventureEncounterBlock._blockLookup[id] = block;

		Renderer._cache.encounter = Renderer?._cache?.encounter || {};

		Renderer._cache.encounter[id] = {
			pFn: async () => {
				await block.pInit({renderer, meta, options});
			},
		};

		textStack[0] += `<style data-rd-cache-id="${id}" data-rd-cache="encounter" onload="Renderer._cache.pRunFromEle(this)"></style>`;
	}
}

const RendererEncounterBlock = {
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

		return textStack[0];
	},

	async _renderEncounterAdjXp (id, comp, rulesClassic, entry, meta, options, {partySize, partyLevel, displayName, block}) {
		const eleRaw = document.getElementById(id);
		if (!eleRaw) return;
		const ele = e_({ele: eleRaw});

		if (!comp?.creatureMetas?.length) {
			ele.find(".difficulty-value")?.html(`<span class="ve-muted">No creatures</span>`);
			ele.find(".initiative-tracker-link")?.attr("data-encounter", "");
			return;
		}

		try {
			const partyMeta = rulesClassic.getEncounterPartyMeta();
			const encounterSpendInfo = partyMeta.getEncounterSpendInfo(comp.creatureMetas);
			const tier = partyMeta.getEncounterTier(encounterSpendInfo);

			const adjXp = encounterSpendInfo.adjustedSpend;
			const totalXp = encounterSpendInfo.baseSpend;
			const multiplier = encounterSpendInfo.playerAdjustedSpendMult;
			const totalNumOfMonsters = encounterSpendInfo.count;
			const avgPartyLevel = partyLevel;

			const xpThresholds = Object.fromEntries(
				TIERS_EXTENDED.map(tierKey => [tierKey, partyMeta.getBudgetRange(tierKey).budgetMin]),
			);
			xpThresholds.trivial = 0;

			const difficultyKey = tier;
			const difficultyText = tier === TIER_TRIVIAL ? "Trivial" : tier.toTitleCase();

			let overThreshold = difficultyKey === TIER_ABSURD
				? adjXp - xpThresholds[TIER_ABSURD]
				: adjXp - xpThresholds[difficultyKey];
			let extraDifficulty = "";
			if (difficultyKey === TIER_ABSURD) {
				const nextThreshold = xpThresholds[TIER_ABSURD] + (xpThresholds[TIER_ABSURD] - xpThresholds[TIER_DEADLY]);
				const percentage = Math.round((overThreshold / (nextThreshold - xpThresholds[TIER_ABSURD])) * 100);
				extraDifficulty = `${percentage}%`;
			} else {
				const tierIx = TIERS_EXTENDED.indexOf(difficultyKey);
				const nextTier = TIERS_EXTENDED[tierIx + 1] || TIER_ABSURD;
				const nextThreshold = xpThresholds[nextTier] || xpThresholds[TIER_ABSURD];
				const percentage = Math.round((overThreshold / (nextThreshold - xpThresholds[difficultyKey])) * 100);
				extraDifficulty = `${percentage}%`;
			}

			const dailyBudget = partyMeta.getDailyBudget();
			const tierTitleKey = difficultyKey === TIER_TRIVIAL ? TIER_EASY : difficultyKey;

			const processedCreatures = block?._sublistManager?.getInitiativeCreatures?.() || [];

			const encounterData = {
				name: displayName || entry.name || null,
				adjxp: adjXp,
				creatures: processedCreatures,
			};

			let difficultyTempStack = [""];
			this._recursiveRender(
				`{@footnote ${difficultyText} ${extraDifficulty ? `+${extraDifficulty}` : ``}|
				Based on a party size of {@color ${partySize}|--rgb-warning} player characters at level {@color ${avgPartyLevel}|--rgb-warning} fighting {@color ${totalNumOfMonsters}|--rgb-warning} hostile creatures:<br/><br/>
				{@b Difficulty}: {@color {@footnote ${difficultyText}|${_TITLE_DIFFICULTIES[tierTitleKey] || ""}|${difficultyText} Encounter} ${overThreshold > 0 ? `+{@footnote ${extraDifficulty}|This encounter's Adjusted XP is {@color ${overThreshold} xp|--rgb-warning} above, or {@color ${extraDifficulty} past|--rgb-warning}, the {@color ${difficultyText}|--rgb-warning} threshold of {@color ${xpThresholds[difficultyKey]}|--rgb-warning} for a party of {@color ${partySize}|--rgb-warning} players at level {@color ${avgPartyLevel}|--rgb-warning}.|${extraDifficulty} beyond ${difficultyText}}` : ``}|--rgb-warning}<br/>
				{@color {@b ${difficultyText} Threshold}: ${xpThresholds[difficultyKey]}|--rgb-font--muted}<br/>
				{@color {@b Creature XP Sum}: ${totalXp}|--rgb-font--muted}<br/>
				{@color {@b Multiplier}: ×${multiplier}|--rgb-font--muted}<br/>
				{@footnote {@b Adjusted XP}|Adjusted by a multiplier of {@color ×${multiplier}|--rgb-warning}, based on a party size of {@color ${partySize}|--rgb-warning} encountering {@color ${totalNumOfMonsters}|--rgb-warning} hostile creatures.<br/><br/>{@note Based on the {@table Encounter Multipliers; Encounter Multipliers|DMG|Encounter Multipliers} table in the {@book DMG}.}<br/><br/>|Adjusted XP}: {@color ${adjXp}|--rgb-warning}<br/>
				{@footnote {@b Daily Budget}|A rough estimate of the adjusted XP value for encounters the party can handle before the characters will need to take a long rest, based on the {@table The Adventuring Day; Adventuring Day XP|DMG|Adventuring Day XP} table in the {@book DMG}.|Daily Budget}: ${dailyBudget}<br/>
				|Encounter Difficulty}`,
				difficultyTempStack,
				meta,
			);

			ele.find(".adj-xp-value")?.txt(`${adjXp}`);
			ele.find(".difficulty-value")?.html(difficultyTempStack.join(""));
			ele.find(".daily-budget-value")?.txt(`${dailyBudget}`);
			ele.find(".initiative-tracker-link")?.attr("data-encounter", JSON.stringify(encounterData));
		} catch (e) {
			ele.find(".difficulty-value")?.html(`<span class="ve-text-danger">Error</span>`);
			ele.find(".adj-xp-value")?.html(`<span class="ve-text-danger">Error</span>`);
			ele.find(".initiative-tracker-link")?.html(`<span class="ve-text-danger">${e.message}</span>`);
		}
	},

	_setupEncounterHeaderControlHandlers (id, entry, defaultVariant, meta, options, block) {
		const eleRaw = document.getElementById(id);
		if (!eleRaw) return;

		RendererEncounterBlock._getEncounterBlockEleById(id, "-party-level-select")?.onChange(() => block.pOnPartyLevelChange());

		if (entry.variations?.length) {
			const variationSelect = RendererEncounterBlock._getEncounterBlockEleById(id, "-variation-select");
			let previousVariantName = variationSelect?.val();

			variationSelect?.onChange(async () => {
				const variantName = String(variationSelect.val());
				if (variantName === String(previousVariantName)) return;

				await block._controls?.pPersistVariantStateNow?.({
					variantKey: block._controls._getVariantStorageKey(previousVariantName),
				});

				previousVariantName = variantName;
				await block.pOnVariationChange();
				await block._controls?.pPersistSelectedVariantName?.({isForce: true});
			});
		}
	},
};

export function register () {
	globalThis.RendererEncounterBlock = RendererEncounterBlock;
}

register();

import "./render-media-cues.js";
