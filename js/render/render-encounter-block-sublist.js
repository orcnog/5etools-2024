import {EncounterBuilderUiBestiary} from "../bestiary/bestiary-encounterbuilder-ui.js";

class _BestiaryUtil {
	static getUrlSubhashes (mon, {isAddLeadingSep = true} = {}) {
		const subhashesRaw = [
			mon._isScaledCr ? `${UrlUtil.HASH_START_CREATURE_SCALED}${mon._scaledCr}` : null,
			mon._summonedBySpell_level ? `${UrlUtil.HASH_START_CREATURE_SCALED_SPELL_SUMMON}${mon._summonedBySpell_level}` : null,
			mon._summonedByClass_level ? `${UrlUtil.HASH_START_CREATURE_SCALED_CLASS_SUMMON}${mon._summonedByClass_level}` : null,
		].filter(Boolean);

		if (!subhashesRaw.length) return "";
		return `${isAddLeadingSep ? HASH_PART_SEP : ""}${subhashesRaw.join(HASH_PART_SEP)}`;
	}

	static getListDisplayType (mon) {
		const pTypes = mon._pTypes?.asTextShort != null ? mon._pTypes : Parser.monTypeToFullObj(mon.type);
		let type = pTypes.asTextShort.uppercaseFirst();
		if (pTypes.asTextSidekick) type += `, ${pTypes.asTextSidekick}`;
		return type;
	}

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

	static getCombatantCreatureTag ({listItem}) {
		return this.getCombatantCreatureTagFromEntity({
			entity: listItem.data.entity,
			displayName: listItem.data.displayName || "",
		});
	}
}

class _AdventureEncounterListPageStub {
	async pDoLoadExportedSublistSources (exportedSublist) {
		if (!exportedSublist?.sources?.length) return;

		const sourcesJson = exportedSublist.sources
			.map(src => Parser.sourceJsonToJson(src));

		const sourcesUnknown = sourcesJson
			.filter(src => !SourceUtil.isSiteSource(src) && !PrereleaseUtil.hasSourceJson(src) && !BrewUtil2.hasSourceJson(src));

		if (sourcesUnknown.length) {
			JqueryUtil.doToast({
				content: `Could not load content from the following source${sourcesUnknown.length === 1 ? "" : "s"}: ${sourcesUnknown.map(it => `"${it}"`).join(", ")}. You may need to load ${sourcesUnknown.length === 1 ? "it" : "them"} as homebrew first.`,
				type: "danger",
				isAutoHide: false,
			});
		}
	}
}

/** Minimal encounter-builder UI for inline adventure encounter blocks. */
export class AdventureEncounterBlockBuilderUi extends EncounterBuilderUiBestiary {
	isActive () { return true; }

	initUi () { /* no-op */ }

	render () { return {}; }

	handleSubhash () { /* no-op */ }

	_showBuilder () { /* no-op */ }

	_hideBuilder () { /* no-op */ }

	onSublistChange () { this._block?.onSublistChange?.(); }

	setBlock (block) { this._block = block; }

	getSublistButtonsMeta (sublistItem) {
		const btnAdd = ee`<button title="Add (SHIFT for 5)" class="ve-btn ve-btn-success ve-btn-xs best-ecgen__btn-list"><span class="glyphicon glyphicon-plus"></span></button>`
			.onn("click", evt => this._handleClick({evt, entity: sublistItem.data.entity, mode: "add"}));

		const btnSub = ee`<button title="Subtract (SHIFT for 5)" class="ve-btn ve-btn-danger ve-btn-xs best-ecgen__btn-list"><span class="glyphicon glyphicon-minus"></span></button>`
			.onn("click", evt => this._handleClick({evt, entity: sublistItem.data.entity, mode: "subtract"}));

		const wrp = ee`<span class="encounter-block-sublist__col encounter-block-sublist__col--btns ve-no-wrap ve-btn-group">
			${btnAdd}
			${btnSub}
		</span>`
			.onn("click", evt => {
				evt.preventDefault();
				evt.stopPropagation();
			});

		return {wrp, fnUpdate: () => {}};
	}

	async _pDoCrChange ({iptCr, monScaled, scaledTo}) {
		const mon = await DataLoader.pCacheAndGetHash(
			UrlUtil.PG_BESTIARY,
			UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](monScaled),
		);

		const baseCr = mon.cr.cr || mon.cr;
		if (baseCr == null) return;
		const baseCrNum = Parser.crToNumber(baseCr);
		const targetCr = iptCr.val();

		if (!Parser.isValidCr(targetCr)) {
			JqueryUtil.doToast({
				content: `"${iptCr.val()}" is not a valid Challenge Rating! Please enter a valid CR (0-30). For fractions, "1/X" should be used.`,
				type: "danger",
			});
			iptCr.val(Parser.numberToCr(scaledTo ?? baseCrNum));
			return;
		}

		const targetCrNum = Parser.crToNumber(targetCr);

		if (targetCrNum === scaledTo) return;

		const state = await this._sublistManager.pGetExportableSublist({isForceIncludePlugins: true, isMemoryOnly: true});
		const toFindHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](mon);

		const toFindUid = !(scaledTo == null || baseCrNum === scaledTo) ? Renderer.monster.getCustomHashId(this.constructor._getFauxMon(mon.name, mon.source, scaledTo)) : null;
		const ixCurrItem = state.items.findIndex(it => {
			if (scaledTo == null || scaledTo === baseCrNum) return !it.customHashId && it.h === toFindHash;
			else return it.customHashId === toFindUid;
		});
		if (!~ixCurrItem) throw new Error(`Could not find previously sublisted item!`);

		const toFindNxtUid = baseCrNum !== targetCrNum ? Renderer.monster.getCustomHashId(this.constructor._getFauxMon(mon.name, mon.source, targetCrNum)) : null;
		const nextItem = state.items.find(it => {
			if (targetCrNum === baseCrNum) return !it.customHashId && it.h === toFindHash;
			else return it.customHashId === toFindNxtUid;
		});

		if (nextItem) {
			const curr = state.items[ixCurrItem];
			nextItem.c = `${Number(nextItem.c || 1) + Number(curr.c || 1)}`;
			state.items.splice(ixCurrItem, 1);
		} else {
			if (targetCrNum === baseCrNum) delete state.items[ixCurrItem].customHashId;
			else state.items[ixCurrItem].customHashId = Renderer.monster.getCustomHashId(this.constructor._getFauxMon(mon.name, mon.source, targetCrNum));
		}

		await this._sublistManager.pDoLoadExportedSublist(state, {isMemoryOnly: true});
		this._block?.onSublistChange?.();
	}
}

export class AdventureEncounterBlockSublistManager extends SublistManager {
	static _ROW_TEMPLATE = [
		new SublistCellTemplate({name: "Name", css: "ve-bold ve-col-4 ve-pl-0 ve-pr-1", colStyle: ""}),
		new SublistCellTemplate({name: "CR", css: "ve-col-1-2 ve-px-1 ve-text-center", colStyle: "text-center"}),
		new SublistCellTemplate({name: "Number", css: "ve-col-2 ve-pl-1 ve-pr-0 ve-text-center", colStyle: "text-center"}),
		new SublistCellTemplate({name: "Notes", css: "ve-col-4-8 ve-pl-1 ve-pr-0", colStyle: ""}),
	];

	constructor ({wrpList, encounterBuilderUi}) {
		super({
			sublistListOptions: {fnSort: null},
			shiftCountAddSubtract: 5,
			isSublistItemsCountable: true,
		});

		this._wrpList = wrpList;
		this._encounterBuilder = encounterBuilderUi;
		this.listPage = new _AdventureEncounterListPageStub();
		this._sortDispCarets = [];
	}

	set encounterBuilder (val) { this._encounterBuilder = val; }

	_resetSublistUserSort () {
		if (!this._listSub) return;

		this._listSub._fnSort = null;
		this._listSub._sortBy = null;
		this._listSub._sortDir = null;
		this._sortDispCarets.forEach(dispCaret => {
			dispCaret.removeClass("ve-lst__caret--active");
			dispCaret.removeClass("ve-lst__caret--reverse");
		});
	}

	_initAdventureBlockSortHandlers (wrpBtnsSort, list) {
		this._sortDispCarets = [...wrpBtnsSort.querySelectorAll("[data-sort]")]
			.map(btnSort => {
				const dispCaret = e_({tag: "span", clazz: "ve-lst__caret"}).appendTo(btnSort);
				const btnSortField = btnSort.dataset.sort;

				e_({
					ele: btnSort,
					click: evt => {
						evt.stopPropagation();
						const direction = list.sortBy === btnSortField && list.sortDir === "asc" ? "desc" : "asc";
						if (!list._fnSort) list._fnSort = PageFilterBestiary.sortMonsters;
						SortUtil._initBtnSortHandlers_showCaret({
							dispCarets: this._sortDispCarets,
							dispCaret,
							direction,
						});
						list.sort(btnSortField, direction);
					},
				});

				return dispCaret;
			});
	}

	async pInitSublist () {
		this._listSub = new List({
			fnSort: null,
			wrpList: this._wrpList,
		});
		this._listSub._sortBy = null;
		this._listSub._sortDir = null;
		this._listSub.init();

		const wrpBtnsSortSublist = document.getElementById(`${this._wrpList.id.replace(/-sublist$/, "-sublistsort")}`);
		if (wrpBtnsSortSublist) this._initAdventureBlockSortHandlers(wrpBtnsSortSublist, this._listSub);

		this._listSub.on("updated", () => {
			this._plugins.forEach(plugin => plugin.onSublistUpdate());
		});
	}

	_isDisplaySublist () { return !!this._listSub?.items?.length; }

	doUpdateSublistVisibility () { /* inline rows always visible */ }

	async _pSaveSublist () { /* no page-level sublist persistence */ }

	_getCustomHashId ({entity}) {
		return Renderer.monster.getCustomHashId(entity);
	}

	_syncListItemFromRowInputs (listItem) {
		if (!listItem?.ele) return;

		const mon = listItem.data.entity;

		const iptName = listItem.ele.find(".encounter-block-sublist__name");
		if (iptName) {
			const val = iptName.val().trim() || mon.name;
			if (val !== mon.name) listItem.data.displayName = val;
			else delete listItem.data.displayName;
			listItem.name = val;
		}

		const iptNote = listItem.ele.find(".encounter-block-sublist__col--notes textarea.encounter-block-sublist__note-edit");
		if (iptNote && !iptNote.hasClass("ve-hidden")) {
			const val = iptNote.val().trim();
			if (val) listItem.data.note = val;
			else delete listItem.data.note;
		}
	}

	pCommitPendingEdits () {
		(this.sublistItems || []).forEach(listItem => this._syncListItemFromRowInputs(listItem));
	}

	getCombatantsFromSublist () {
		this.pCommitPendingEdits();

		return (this.sublistItems || []).map(listItem => {
			const out = {
				creature: _BestiaryUtil.getCombatantCreatureTag({listItem}),
				quantity: Number(listItem.data.count) > -1 ? Number(listItem.data.count) : 1,
			};
			if (listItem.data.note) out.note = listItem.data.note;
			return out;
		});
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
					creature: _BestiaryUtil.getCombatantCreatureTagFromEntity({
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

	_getSerializedPinnedItemData (listItem) {
		this._syncListItemFromRowInputs(listItem);

		return {
			cId: listItem.data.collectionId,
			l: listItem.data.isLocked ? listItem.data.isLocked : undefined,
			dn: listItem.data.displayName || undefined,
			n: listItem.data.note || undefined,
		};
	}

	_getDeserializedPinnedItemData (serialData) {
		if (!serialData) return {};
		return {
			collectionId: serialData.cId,
			isLocked: !!serialData.l,
			displayName: serialData.dn || "",
			note: serialData.n || "",
		};
	}

	_onSublistChange () {
		this._encounterBuilder?.onSublistChange?.();
	}

	_getSublistFullHash ({entity}) {
		return `${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](entity)}${_BestiaryUtil.getUrlSubhashes(entity)}`;
	}

	async pDoLoadExportedSublist (
		exportedSublist,
		{
			isAdditive = false,
			isMemoryOnly = false,
			isNoSave = false,
		} = {},
	) {
		if (!isAdditive) this._resetSublistUserSort();

		if (exportedSublist) ListUtil.getWithoutManagerClientState(exportedSublist);

		await this._plugins.pSerialAwaitMap(plugin => plugin.pMutLegacyData({exportedSublist, isMemoryOnly}));

		await this._listPage.pDoLoadExportedSublistSources(exportedSublist);

		const entityInfos = await (exportedSublist?.items || [])
			.pSerialAwaitMap(async ser => {
				let entity = await DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, ser.h);
				if (!entity) return null;

				entity = await Renderer.hover.pApplyCustomHashId(
					UrlUtil.PG_BESTIARY,
					entity,
					ser.customHashId || ser.customhashid,
				);
				if (!entity) return null;

				return {
					count: isNaN(ser.c) ? 1 : Number(ser.c),
					entity,
					ser,
				};
			})
			.then(arr => arr.filter(Boolean));

		if (exportedSublist && !isAdditive) await this.pDoSublistRemoveAll({isNoSave: true});

		for (const entityInfo of entityInfos) {
			const {count, entity, ser} = entityInfo;

			await this.pDoSublistAdd({
				addCount: count,
				entity,
				initialData: this._getDeserializedPinnedItemData(ser),
				doFinalize: false,
			});
		}

		await this._plugins.pSerialAwaitMap(plugin => plugin.pLoadData({
			exportedSublist,
			isAdditive,
			isMemoryOnly,
		}));

		await this._pFinaliseSublist({isNoSave});
	}

	_getSublistDisplayName ({listItem, mon}) {
		return listItem?.data?.displayName || mon.name;
	}

	_getRenderedNoteHtml (note) {
		if (!note) return "";
		return Renderer.get().render(note);
	}

	_updateSublistNoteDisplay ({wrpNote, listItem, display: displayOpt}) {
		const display = displayOpt || wrpNote?.find?.(".encounter-block-sublist__note-display");
		if (!display) return;

		const note = listItem.data.note || "";
		display.html(note ? this._getRenderedNoteHtml(note) : "");
	}

	_createSublistNoteEle ({listItem}) {
		const display = ee`<span class="encounter-block-sublist__note-display"></span>`;
		const textarea = ee`<textarea class="encounter-block-sublist__note-edit ve-hidden ve-resize-none ve-w-100" rows="1"></textarea>`;

		const fnAutoSizeTextarea = () => {
			textarea.css("height", "auto");
			textarea.css("height", `${textarea.scrollHeight}px`);
		};

		const fnShowEdit = () => {
			textarea.val(listItem.data.note || "");
			display.addClass("ve-hidden");
			textarea.removeClass("ve-hidden");
			fnAutoSizeTextarea();
			textarea.focuse();
		};

		const fnCommitEdit = () => {
			const val = textarea.val().trim();
			if (val) listItem.data.note = val;
			else delete listItem.data.note;
			this._updateSublistNoteDisplay({wrpNote, listItem, display});
			textarea.addClass("ve-hidden");
			textarea.css("height", "");
			display.removeClass("ve-hidden");
			this._onSublistChange();
		};

		const fnHandleNoteActivate = evt => {
			if (evt.target.closest("a, .ve-roller, .roller")) return;
			if (evt.target.closest("textarea.encounter-block-sublist__note-edit") && !textarea.hasClass("ve-hidden")) return;
			evt.stopPropagation();
			fnShowEdit();
		};

		textarea
			.onn("click", evt => evt.stopPropagation())
			.onn("input", fnAutoSizeTextarea)
			.onn("blur", fnCommitEdit)
			.onn("keydown", evt => {
				if (evt.key === "Escape") {
					textarea.addClass("ve-hidden");
					textarea.css("height", "");
					display.removeClass("ve-hidden");
				}
			});

		const wrpNote = ee`<span class="encounter-block-sublist__col encounter-block-sublist__col--notes" tabindex="0">
			<span class="encounter-block-sublist__note-inner">
				${display}
				${textarea}
			</span>
		</span>`
			.onn("mousedown", evt => {
				if (evt.target.closest("a, .ve-roller, .roller")) return;
				evt.stopPropagation();
			})
			.onn("click", fnHandleNoteActivate)
			.onn("keydown", evt => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					fnShowEdit();
				}
			});
		this._updateSublistNoteDisplay({wrpNote, listItem, display});

		return wrpNote;
	}

	_bindEditableDisplayName ({ipt, listItem, mon}) {
		ipt
			.onn("mousedown", evt => evt.stopPropagation())
			.onn("click", evt => {
				evt.stopPropagation();
				if (ipt.readOnly) {
					ipt.attr("readonly", false);
					ipt.focus();
					ipt.select();
				}
			})
			.onn("focus", () => ipt.attr("readonly", false))
			.onn("blur", () => {
				ipt.attr("readonly", true);
				const val = ipt.val().trim() || mon.name;
				if (val !== mon.name) listItem.data.displayName = val;
				else delete listItem.data.displayName;
				listItem.name = val;
				ipt.val(val);
				this._onSublistChange();
			})
			.onn("keydown", evt => {
				if (evt.key === "Enter") ipt.blur();
			});
	}

	getInitiativeCreatures () {
		const out = [];
		(this.sublistItems || []).forEach(listItem => {
			const mon = listItem.data.entity;
			const hash = `${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](mon)}${_BestiaryUtil.getUrlSubhashes(mon)}`;
			const name = this._getSublistDisplayName({listItem, mon});
			const note = listItem.data.note || "";
			const count = Number(listItem.data.count) || 1;

			for (let i = 0; i < count; i++) {
				const creature = {
					...MiscUtil.copyFast(mon),
					hash,
					name,
				};
				if (note) creature.note = note;
				out.push(creature);
			}
		});
		return out;
	}

	async pGetSublistItem (mon, hash, {count = 1, customHashId = null, initialData} = {}) {
		Renderer.monster.updateParsed(mon);
		const displayName = initialData?.displayName || mon.name;
		const note = initialData?.note || "";
		const type = _BestiaryUtil.getListDisplayType(mon);
		const cr = mon._pCr;
		const hashBase = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](mon);
		const collectionId = initialData?.collectionId;
		const isLocked = !!initialData?.isLocked;

		const cellsText = [displayName, cr, note];

		const iptDisplayName = ee`<input class="ve-w-100 ve-bold best-ecgen__name--sub encounter-block-sublist__col encounter-block-sublist__col--name ve-form-control form-control--minimal ve-input-xs encounter-block-sublist__name" readonly value="${displayName}">`
			.onn("mouseover", evt => this._encounterBuilder.doStatblockMouseOver({
				evt,
				ele: iptDisplayName,
				source: mon.source,
				hash: hashBase,
				customHashId: this._getCustomHashId({entity: mon}),
			}))
			.onn("mousemove", evt => Renderer.hover.handleLinkMouseMove(evt, iptDisplayName))
			.onn("mouseleave", evt => Renderer.hover.handleLinkMouseLeave(evt, iptDisplayName));

		const ptCr = (() => {
			if (!ScaleCreature.isCrInScaleRange(mon)) {
				return ee`<span class="encounter-block-sublist__col encounter-block-sublist__col--cr ve-text-center">${cr}</span>`;
			}

			const iptCr = ee`<input value="${cr}" class="ve-w-100 ve-text-center ve-form-control form-control--minimal ve-input-xs">`
				.onn("click", () => iptCr.selecte())
				.onn("change", () => this._encounterBuilder.pDoCrChange(iptCr, mon, mon._scaledCr));

			return ee`<span class="encounter-block-sublist__col encounter-block-sublist__col--cr ve-text-center ve-pr-1p">${iptCr}</span>`;
		})();

		const comp = BaseComponent.fromObject({count});
		const ipt = ComponentUiUtil.getIptNumber(comp, "count", 1, {
			fallbackOnNaN: count,
			html: `<input class="ve-w-100 ve-text-center ve-form-control form-control--minimal ve-input-xs">`,
		});
		comp._addHookBase("count", () => {
			if (comp._state.count <= 0) {
				this.pDoSublistRemove({entity: mon, doFinalize: true}).then(null);
				return;
			}
			this.pDoSublistSetCount({entity: mon, doFinalize: true, count: comp._state.count}).then(null);
		});
		const stgCount2 = ee`<span class="encounter-block-sublist__col encounter-block-sublist__col--num ve-pr-0 ve-text-center ve-pl-1p">${ipt}</span>`;

		const listItem = new ListItem(
			hash,
			null,
			displayName,
			{
				hash,
				source: Parser.sourceJsonToAbv(mon.source),
				type,
				cr,
				page: mon.page,
			},
			{
				count,
				customHashId,
				collectionId,
				isLocked,
				displayName: initialData?.displayName || "",
				note,
				elesCount: [],
				fnsUpdate: [],
				entity: mon,
				entityBase: await DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, hashBase),
				mdRow: [...cellsText, ({listItem}) => listItem.data.count],
			},
		);

		const stgNote = this._createSublistNoteEle({listItem});

		listItem.data.fnsUpdate.push(({sublistItem}) => {
			comp._state.count = sublistItem.data.count;
			iptDisplayName.val(this._getSublistDisplayName({listItem: sublistItem, mon}));
			this._updateSublistNoteDisplay({wrpNote: stgNote, listItem: sublistItem});
		});

		this._bindEditableDisplayName({ipt: iptDisplayName, listItem, mon});

		const sublistButtonsMeta = this._encounterBuilder.getSublistButtonsMeta(listItem);
		listItem.data.fnsUpdate.push(sublistButtonsMeta.fnUpdate);

		listItem.ele = ee`<div class="ve-lst__row ve-lst__row--sublist ve-flex-col ve-lst__row--bestiary-sublist">
			<div class="ve-lst__wrp-cells encounter-block-sublist__grid best-ecgen__visible ve-lst__row-border ve-lst__row-inner">
				${sublistButtonsMeta.wrp}
				${iptDisplayName}
				${ptCr}
				${stgCount2}
				${stgNote}
			</div>
		</div>`
			.onn("click", evt => {
				if (evt.target.closest("input, button, textarea, select, a, .encounter-block-sublist__col--notes")) return;
				evt.preventDefault();
			});

		return listItem;
	}

	async pPopulateFromCombatants ({combatants}) {
		this._resetSublistUserSort();
		await this.pDoSublistRemoveAll({isNoSave: true});

		await (combatants || []).pSerialAwaitMap(async combatant => {
			if (!combatant?.creature) return;

			const [tagName, textArgs] = Renderer.splitFirstSpace(combatant.creature.slice(1, -1));
			const {hash, subhashes, displayText} = Renderer.utils.getTagMeta(tagName, textArgs);
			let baseMon = await DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, hash);
			if (!baseMon) return;

			if (displayText) baseMon = MiscUtil.copyFast(baseMon);

			const scaledCr = subhashes?.find(item => item.key === "scaled")?.value;
			if (scaledCr !== undefined) {
				baseMon = await ScaleCreature.scale(baseMon, scaledCr);
			}
			Renderer.monster.updateParsed(baseMon);

			const qty = Number(combatant.quantity) > -1 ? Number(combatant.quantity) : 1;
			const initialData = {};
			if (displayText) initialData.displayName = displayText;
			if (combatant.note) initialData.note = String(combatant.note);

			await this.pDoSublistAdd({
				entity: baseMon,
				addCount: qty,
				initialData: Object.keys(initialData).length ? initialData : null,
				doFinalize: false,
			});
		});

		await this._pFinaliseSublist({isNoSave: true});
	}

	async pGetExportableEncounterSublist () {
		return this.pGetExportableSublist({isForceIncludePlugins: false});
	}
}
