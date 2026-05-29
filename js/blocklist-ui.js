"use strict";

class BlocklistUtil {
	static _IGNORED_CATEGORIES = new Set([
		"_meta",
		"_test",
		"linkedLootTables",
		"$schema",

		// `items-base.json`
		"itemProperty",
		"itemType",
		"itemEntry",
		"itemTypeAdditionalEntries",

		// `languages.json`
		"languageScript",

		// homebrew corpus
		"adventureData",
		"bookData",
	]);

	static _BASIC_FILES = [
		"actions.json",
		"adventures.json",
		"backgrounds.json",
		"books.json",
		"cultsboons.json",
		"charcreationoptions.json",
		"conditionsdiseases.json",
		"deities.json",
		"feats.json",
		"items-base.json",
		"magicvariants.json",
		"items.json",
		"objects.json",
		"optionalfeatures.json",
		"psionics.json",
		"recipes.json",
		"rewards.json",
		"trapshazards.json",
		"variantrules.json",
		"vehicles.json",
		"decks.json",
		"languages.json",
		"bastions.json",
	];

	static async pLoadData (
		{
			isIncludePrerelease = false,
			isIncludeBrew = false,
		} = {},
	) {
		const out = await this._pLoadData_site();
		if (isIncludePrerelease) await this._pLoadData_mutAddPrerelease({out});
		if (isIncludeBrew) await this._pLoadData_mutAddBrew({out});
		return out;
	}

	/* ----- */

	static async _pLoadData_site () {
		const out = {};

		this._addData(out, {monster: MiscUtil.copy(await DataUtil.monster.pLoadAll())});
		this._addData(out, {spell: MiscUtil.copy(await DataUtil.spell.pLoadAll())});
		this._addData(out, MiscUtil.copy(await DataUtil.class.loadRawJSON()));
		this._addData(out, MiscUtil.copy(await DataUtil.race.loadJSON({isAddBaseRaces: true})));

		(
			await Promise.all(this._BASIC_FILES.map(url => DataUtil.loadJSON(`${Renderer.get().baseUrl}data/${url}`)))
		)
			.forEach(json => this._addData(out, MiscUtil.copyFast(json)));

		return out;
	}

	/* ----- */

	static async _pLoadData_mutAddPrereleaseBrew ({out, brewUtil}) {
		const brew = await brewUtil.pGetBrewProcessed();
		this._addData(out, MiscUtil.copyFast(brew));
	}

	static async _pLoadData_mutAddPrerelease ({out}) {
		await this._pLoadData_mutAddPrereleaseBrew({out, brewUtil: PrereleaseUtil});
	}

	static async _pLoadData_mutAddBrew ({out}) {
		await this._pLoadData_mutAddPrereleaseBrew({out, brewUtil: BrewUtil2});
	}

	/* ----- */

	static _addData (out, json) {
		Object.keys(json)
			.filter(it => !this._IGNORED_CATEGORIES.has(it))
			.forEach(k => out[k] ? out[k] = out[k].concat(json[k]) : out[k] = json[k]);
	}
}

globalThis.BlocklistUtil = BlocklistUtil;

class BlocklistUi {
	static _PHB_SOURCE = "PHB";
	/** Legacy PHB categories that were partially blocked; kept for cleanup when unblocking Non-Star Wars. */
	static _PHB_ALLOWED_CATEGORIES = new Set([
		"action",
		"book",
		"condition",
		"sense",
		"status",
		"trap",
		"variantrule", // "Rule"
        "rule"
	]);

	constructor (
		{
			wrpContent,
			data,
			isCompactUi = false,
			isAutoSave = true,
		},
	) {
		this._wrpContent = wrpContent;
		this._data = data;
		this._isCompactUi = !!isCompactUi;
		this._isAutoSave = !!isAutoSave;
		this._isRequireSave = false; // (For Foundry use)

		this._excludes = ExcludeUtil.getList();

		this._subBlocklistEntries = {};

		this._allSources = null;
		this._allCategories = null;

		this._wrpControls = null;

		this._comp = null;

		this._wrpSelName = null;
		this._metaSelName = null;
	}

	async _pDoPersist (nxtList) {
		nxtList ||= MiscUtil.copy(this._excludes);

		if (this._isAutoSave) {
			await ExcludeUtil.pSetList(nxtList);
			if (typeof EditionMode !== "undefined") await EditionMode.pSyncFromBlocklist();
			if (typeof ContentMode !== "undefined") await ContentMode.pSyncFromBlocklist();
			return;
		}

		this._isRequireSave = true;
	}

	_addExclude (displayName, hash, category, source, {isSkipPersist = false} = {}) {
		if (!this._excludes.find(row => row.source === source && row.category === category && row.hash === hash)) {
			this._excludes.push({displayName, hash, category, source});
			if (!isSkipPersist) this._pDoPersist().then(null);
			return true;
		}
		return false;
	}

	_removeExclude (hash, category, source, {isSkipPersist = false} = {}) {
		const ix = this._excludes.findIndex(row => row.source === source && row.category === category && row.hash === hash);
		if (!~ix) return;

		if (this._excludes[ix].isAuto) return;

		this._excludes.splice(ix, 1);
		if (!isSkipPersist) this._pDoPersist().then(null);
	}

	_resetExcludes () {
		this._excludes = this._excludes.filter(excludeMeta => excludeMeta.isAuto);
		this._pDoPersist().then(null);
	}

	async _pInitSubBlocklistEntries () {
		for (const c of (this._data.class || [])) {
			const classHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](c);

			const subBlocklist = this._data.classFeature
				.filter(it => it.className === c.name && it.classSource === c.source)
				.map(it => {
					const hash = UrlUtil.URL_TO_HASH_BUILDER["classFeature"](it);
					const displayName = `${this._getDisplayNamePrefix_classFeature(it)}${it.name}`;
					return {displayName, hash, category: "classFeature", source: it.source};
				});
			MiscUtil.set(this._subBlocklistEntries, "class", classHash, subBlocklist);
		}

		for (const sc of (this._data.subclass || [])) {
			const subclassHash = UrlUtil.URL_TO_HASH_BUILDER["subclass"](sc);

			const subBlocklist = this._data.subclassFeature
				.filter(it => it.className === sc.className && it.classSource === sc.classSource && it.subclassShortName === sc.shortName && it.subclassSource === sc.source)
				.map(it => {
					const hash = UrlUtil.URL_TO_HASH_BUILDER["subclassFeature"](it);
					const displayName = `${this._getDisplayNamePrefix_subclassFeature(it)}${it.name}`;
					return {displayName, hash, category: "subclassFeature", source: it.source};
				});
			MiscUtil.set(this._subBlocklistEntries, "subclass", subclassHash, subBlocklist);
		}

		for (const it of (this._data.itemGroup || [])) {
			const itemGroupHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS](it);

			const subBlocklist = (await it.items.pSerialAwaitMap(async uid => {
				let [name, source] = uid.split("|");
				source = Parser.getTagSource("item", source);
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS]({name, source});
				const item = await DataLoader.pCacheAndGet(UrlUtil.PG_ITEMS, source, hash);
				if (!item) return null;
				return {displayName: item.name, hash, category: "item", source: item.source};
			})).filter(Boolean);

			MiscUtil.set(this._subBlocklistEntries, "itemGroup", itemGroupHash, subBlocklist);
		}

		for (const it of (this._data.race || []).filter(it => it._isBaseRace || it._versions?.length)) {
			const baseRaceHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES](it);
			const subBlocklist = [];

			if (it._isBaseRace) {
				subBlocklist.push(
					...it._subraces.map(sr => {
						const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES](sr);
						return {displayName: sr.name, hash, category: "race", source: sr.source};
					}),
				);
			}

			if (it._versions?.length) {
				subBlocklist.push(
					...DataUtil.proxy.getVersions(it.__prop, it).map(ver => {
						const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES](ver);
						return {displayName: ver.name, hash, category: "race", source: ver.source};
					}),
				);
			}

			MiscUtil.set(this._subBlocklistEntries, "race", baseRaceHash, subBlocklist);
		}
	}

	_getDisplayValues (category, source) {
		const displaySource = source === "*" ? source : Parser.sourceJsonToFullCompactPrefix(source);
		const displayCategory = category === "*" ? category : Parser.getPropDisplayName(category);
		return {displaySource, displayCategory};
	}

	_renderList () {
		this._excludes
			.sort((a, b) => SortUtil.ascSort(a.source, b.source) || SortUtil.ascSort(a.category, b.category) || SortUtil.ascSort(a.displayName, b.displayName))
			.forEach(excludeMeta => this._addListItem(excludeMeta));
		this._list.init();
		this._list.update();
	}

	_getDisplayNamePrefix_classFeature (it) { return `${it.className} ${it.level}: `; }
	_getDisplayNamePrefix_subclassFeature (it) { return `${it.className} (${it.subclassShortName}) ${it.level}: `; }

	async pInit () {
		await this._pInitSubBlocklistEntries();
		this._pInit_initUi();
		this._pInit_render();
		this._renderList();

		// Listen for exclusion changes from navigation buttons
		window.addEventListener("exclusionsChanged", () => {
			this._refreshListFromStorage();
		});
	}

	_pInit_initUi () {
		this._wrpControls = ee`<div ${this._isCompactUi ? "" : `class="bg-solid ve-py-5 ve-px-3 shadow-big ve-b-1p"`}></div>`;

		const iptSearch = ee`<input type="search" class="search ve-form-control ve-lst__search ve-lst__search--no-border-h ve-h-100">`.disableSpellcheck();

		const btnReset = ee`<button class="ve-btn ve-btn-default">Reset Search</button>`
			.onn("click", () => {
				iptSearch.val("");
				this._list.reset();
			});

		const wrpFilterTools = ee`<div class="ve-input-group ve-input-group--bottom ve-flex ve-no-shrink">
			<button class="ve-col-4 sort ve-btn ve-btn-default ve-btn-xs ve-grow" data-sort="source">Source</button>
			<button class="ve-col-2 sort ve-btn ve-btn-default ve-btn-xs" data-sort="category">Category</button>
			<button class="ve-col-5 sort ve-btn ve-btn-default ve-btn-xs" data-sort="name">Name</button>
			<button class="ve-col-1 sort ve-btn ve-btn-default ve-btn-xs" disabled>&nbsp;</button>
		</div>`;

		const wrpList = ee`<div class="list-display-only ve-smooth-scroll ve-overflow-y-auto ve-h-100 ve-min-h-0"></div>`;

		ee(this._wrpContent.empty())`
			${this._wrpControls}

			<hr class="${this._isCompactUi ? "ve-hr-2" : "ve-hr-5"}">

			<h4 class="ve-my-0">Blocklist</h4>
			<div class="ve-muted ${this._isCompactUi ? "ve-mb-2" : "ve-mb-3"}"><i>Rows marked with an asterisk (*) in a field match everything in that field.</i></div>

			<div class="ve-flex-col ve-min-h-0">
				<div class="ve-flex-v-stretch ve-input-group ve-input-group--top ve-no-shrink">
					<div class="ve-w-100 ve-relative">
						${iptSearch}
						<div class="ve-lst__wrp-search-glass ve-no-events ve-flex-vh-center"><span class="glyphicon glyphicon-search"></span></div>
						<div class="ve-lst__wrp-search-visible ve-no-events ve-flex-vh-center"></div>
					</div>
					${btnReset}
				</div>

				${wrpFilterTools}

				${wrpList}
			</div>`;

		this._list = new List({
			iptSearch,
			wrpList,
		});
		this._listId = 1;

		SortUtil.initBtnSortHandlers(wrpFilterTools, this._list);
	}

	_pInit_render () {
		// region Helper controls
		const btnExcludeAllUa = this._getBtn_addToBlocklist()
			.onn("click", () => this._addAllUa());
		const btnIncludeAllUa = this._getBtn_removeFromBlocklist()
			.onn("click", () => this._removeAllUa());

		const btnExcludeAllSources = this._getBtn_addToBlocklist()
			.onn("click", () => this._addAllSources());
		const btnIncludeAllSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => this._removeAllSources());

		const btnExcludeAllComedySources = this._getBtn_addToBlocklist()
			.onn("click", () => this._addAllComedySources());
		const btnIncludeAllComedySources = this._getBtn_removeFromBlocklist()
			.onn("click", () => this._removeAllComedySources());

		const btnExcludeAllNonForgottenRealmsSources = this._getBtn_addToBlocklist()
			.onn("click", () => this._addAllNonForgottenRealms());
		const btnIncludeAllNonForgottenRealmsSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => this._removeAllNonForgottenRealms());

		const btnExcludeClassicSources = this._getBtn_addToBlocklist()
			.onn("click", () => BlocklistUi.addAllClassicSources().then(null));
		const btnIncludeClassicSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => BlocklistUi.removeAllClassicSources().then(null));

		const btnExcludeModernSources = this._getBtn_addToBlocklist()
			.onn("click", () => BlocklistUi.addAllModernSources().then(null));
		const btnIncludeModernSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => BlocklistUi.removeAllModernSources().then(null));

		const btnExcludeSW5eSources = this._getBtn_addToBlocklist()
			.onn("click", () => BlocklistUi.addAllSW5eSources().then(null));
		const btnIncludeSW5eSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => BlocklistUi.removeAllSW5eSources().then(null));
		const btnExcludeNonSW5eSources = this._getBtn_addToBlocklist()
			.onn("click", () => BlocklistUi.addAllNonSW5eSources().then(null));
		const btnIncludeNonSW5eSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => BlocklistUi.removeAllNonSW5eSources().then(null));

		const btnExcludeHomebrewSources = this._getBtn_addToBlocklist()
			.onn("click", () => this._addAllHomebrewSources());
		const btnIncludeHomebrewSources = this._getBtn_removeFromBlocklist()
			.onn("click", () => this._removeAllHomebrewSources());

		// endregion

		// region Primary controls
		const sourceSet = new Set();
		const propSet = new Set();
		Object.keys(this._data).forEach(prop => {
			propSet.add(prop);
			const arr = this._data[prop];
			if (!(arr instanceof Array)) return;
			arr.forEach(it => sourceSet.add(SourceUtil.getEntitySource(it)));
		});

		this._allSources = [...sourceSet]
			.sort((a, b) => SortUtil.ascSort(Parser.sourceJsonToFull(a), Parser.sourceJsonToFull(b)));

		this._allCategories = [...propSet]
			.sort((a, b) => SortUtil.ascSort(Parser.getPropDisplayName(a), Parser.getPropDisplayName(b)));

		this._comp = new BlocklistUi.Component();

		const selSource = ComponentUiUtil.getSelSearchable(
			this._comp,
			"source",
			{
				values: ["*", ...this._allSources],
				fnDisplay: val => val === "*" ? val : Parser.sourceJsonToFull(val),
			},
		);
		this._comp.addHook("source", () => this._doHandleSourceCategorySelChange());

		const selCategory = ComponentUiUtil.getSelSearchable(
			this._comp,
			"category",
			{
				values: ["*", ...this._allCategories],
				fnDisplay: val => val === "*" ? val : Parser.getPropDisplayName(val),
			},
		);
		this._comp.addHook("category", () => this._doHandleSourceCategorySelChange());

		this._wrpSelName = ee`<div class="ve-w-100 ve-flex"></div>`;
		this._doHandleSourceCategorySelChange();

		const btnAddExclusion = ee`<button class="ve-btn ve-btn-default ve-btn-xs">Add to Blocklist</button>`
			.onn("click", () => this._pAdd());
		// endregion

		// Utility controls
		const btnSendToFoundry = !globalThis.IS_VTT && ExtensionUtil.ACTIVE
			? ee`<button title="Send to Foundry" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2"><span class="glyphicon glyphicon-send"></span></button>`
				.onn("click", evt => this._pDoSendToFoundry({isTemp: !!evt.shiftKey}))
			: null;
		const btnExport = ee`<button class="ve-btn ve-btn-default ve-btn-xs">Export List</button>`
			.onn("click", () => this._export());
		const btnImport = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="SHIFT for Add Only">Import List</button>`
			.onn("click", evt => this._pImport(evt));
		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-xs">Reset List</button>`
			.onn("click", async () => {
				if (!await InputUiUtil.pGetUserBoolean({title: "Reset Blocklist", htmlDescription: "Are you sure?", textYes: "Yes", textNo: "Cancel"})) return;
				this._reset();
			});
		// endregion

		ee(this._wrpControls.empty())`<div class="${this._isCompactUi ? "ve-mb-2" : "ve-mb-5"} ve-flex-v-center ve-mobile-md__flex-col ve-mobile-md__flex-ai-start">
			<div class="ve-flex-vh-center ve-mr-4 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">UA/Etc. Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeAllUa}
					${btnIncludeAllUa}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">Comedy Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeAllComedySources}
					${btnIncludeAllComedySources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">Non-<i>Forgotten Realms</i></div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeAllNonForgottenRealmsSources}
					${btnIncludeAllNonForgottenRealmsSources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">5e (&apos;14) Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeClassicSources}
					${btnIncludeClassicSources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">5.5e (&apos;24) Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeModernSources}
					${btnIncludeModernSources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-md__mr-0 ve-mobile-md__mb-2">
				<div class="ve-mr-2">All Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeAllSources}
					${btnIncludeAllSources}
				</div>
			</div>
		</div>

		<div class="${this._isCompactUi ? "ve-mb-2" : "ve-mb-5"} ve-flex-v-center ve-mobile-sm__flex-col ve-mobile-sm__flex-ai-start">

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-sm__mr-0 ve-mobile-sm__mb-2">
				<div class="ve-mr-2"><em>Star Wars</em> Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeSW5eSources}
					${btnIncludeSW5eSources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-sm__mr-0 ve-mobile-sm__mb-2">
				<div class="ve-mr-2">Non-<em>Star Wars</em> Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeNonSW5eSources}
					${btnIncludeNonSW5eSources}
				</div>
			</div>

			<div class="ve-flex-vh-center ve-mr-3 ve-mobile-sm__mr-0 ve-mobile-sm__mb-2">
				<div class="ve-mr-2">All Homebrew Sources</div>
				<div class="ve-flex-v-center ve-btn-group">
					${btnExcludeHomebrewSources}
					${btnIncludeHomebrewSources}
				</div>
			</div>
		</div>

		<div class="ve-flex-v-end ${this._isCompactUi ? "ve-mb-2" : "ve-mb-5"} ve-mobile-sm__flex-col ve-mobile-sm__flex-ai-start">
			<div class="ve-flex-col ve-w-25 ve-pr-2 ve-mobile-sm__w-100 ve-mobile-sm__mb-2 ve-mobile-sm__p-0">
				<label class="ve-mb-1">Source</label>
				${selSource}
			</div>

			<div class="ve-flex-col ve-w-25 ve-px-2 ve-mobile-sm__w-100 ve-mobile-sm__mb-2 ve-mobile-sm__p-0">
				<label class="ve-mb-1">Category</label>
				${selCategory}
			</div>

			<div class="ve-flex-col ve-w-25 ve-px-2 ve-mobile-sm__w-100 ve-mobile-sm__mb-2 ve-mobile-sm__p-0">
				<label class="ve-mb-1">Name</label>
				${this._wrpSelName}
			</div>

			<div class="ve-flex-col ve-w-25 ve-pl-2 ve-mobile-sm__w-100 ve-mobile-sm__mb-2 ve-mobile-sm__p-0">
				<div class="ve-mt-auto">
					${btnAddExclusion}
				</div>
			</div>
		</div>

		<div class="ve-w-100 ve-flex-v-center">
			${btnSendToFoundry}
			<div class="ve-flex-v-center ve-btn-group ve-mr-2">
				${btnExport}
				${btnImport}
			</div>
			${btnReset}
		</div>`;
	}

	_getBtn_addToBlocklist () {
		return ee`<button class="ve-btn ve-btn-danger ve-btn-xs ve-w-20p ve-h-21p ve-flex-vh-center" title="Add to Blocklist"><span class="glyphicon glyphicon-trash"></span></button>`;
	}

	_getBtn_removeFromBlocklist () {
		return ee`<button class="ve-btn ve-btn-success ve-btn-xs ve-w-20p ve-h-21p ve-flex-vh-center" title="Remove from Blocklist"><span class="glyphicon glyphicon-thumbs-up"></span></button>`;
	}

	_doHandleSourceCategorySelChange () {
		if (this._metaSelName) this._metaSelName.unhook();
		this._wrpSelName.empty();

		const filteredData = this._doHandleSourceCategorySelChange_getFilteredData();

		const selName = ComponentUiUtil.getSelSearchable(
			this._comp,
			"name",
			{
				values: [
					{hash: "*", name: "*", category: this._comp.category},
					...this._getDataUids(filteredData),
				],
				fnDisplay: val => val.name,
			},
		);

		this._wrpSelName.append(selName);
	}

	_doHandleSourceCategorySelChange_getFilteredData () {
		// If the user has not selected either of source or category, avoid displaying the entire data set
		if (this._comp.source === "*" && this._comp.category === "*") return [];

		if (this._comp.source === "*" && this._comp.category !== "*") {
			return this._data[this._comp.category].map(it => ({...it, category: this._comp.category}));
		}

		if (this._comp.source !== "*" && this._comp.category === "*") {
			return Object.entries(this._data).map(([cat, arr]) => arr.filter(it => it.source === this._comp.source).map(it => ({...it, category: cat}))).flat();
		}

		return this._data[this._comp.category]
			.filter(it => SourceUtil.getEntitySource(it) === this._comp.source)
			.map(it => ({...it, category: this._comp.category}));
	}

	_getDataUids (arr) {
		const copy = arr
			.map(it => {
				switch (it.category) {
					case "subclass": {
						return {...it, name: it.name, source: SourceUtil.getEntitySource(it), className: it.className, classSource: it.classSource, shortName: it.shortName};
					}
					case "classFeature": {
						return {...it, name: it.name, source: SourceUtil.getEntitySource(it), className: it.className, classSource: it.classSource, level: it.level};
					}
					case "subclassFeature": {
						return {...it, name: it.name, source: SourceUtil.getEntitySource(it), className: it.className, classSource: it.classSource, level: it.level, subclassShortName: it.subclassShortName, subclassSource: it.subclassSource};
					}
					case "adventure":
					case "book": {
						return {...it, name: it.name, source: SourceUtil.getEntitySource(it), id: it.id};
					}
					default: {
						return {...it, name: it.name, source: SourceUtil.getEntitySource(it)};
					}
				}
			})
			.sort(this.constructor._fnSortDataUids.bind(this.constructor));

		const dupes = new Set();
		return copy
			.map((it, i) => {
				let prefix = "";
				let hash;

				if (UrlUtil.URL_TO_HASH_BUILDER[it.category]) {
					hash = UrlUtil.URL_TO_HASH_BUILDER[it.category](it);
				} else {
					hash = UrlUtil.encodeForHash([it.name, SourceUtil.getEntitySource(it)]);
				}

				switch (it.category) {
					case "subclass": prefix = `${it.className}: `; break;
					case "classFeature": prefix = this._getDisplayNamePrefix_classFeature(it); break;
					case "subclassFeature": prefix = this._getDisplayNamePrefix_subclassFeature(it); break;
				}

				const displayName = `${prefix}${it.name}${(dupes.has(it.name) || (copy[i + 1] && copy[i + 1].name === it.name)) ? ` [${Parser.sourceJsonToAbv(SourceUtil.getEntitySource(it))}]` : ""}`;

				dupes.add(it.name);
				return {
					hash,
					name: displayName,
					category: it.category,
				};
			});
	}

	static _fnSortDataUids (a, b) {
		if (a.category !== b.category) return SortUtil.ascSortLower(a.category, b.category);
		switch (a.category) {
			case "subclass": {
				return SortUtil.ascSortLower(a.className, b.className) || SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source);
			}
			case "classFeature": {
				return SortUtil.ascSortLower(a.className, b.className) || SortUtil.ascSort(a.level, b.level) || SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source);
			}
			case "subclassFeature": {
				return SortUtil.ascSortLower(a.className, b.className) || SortUtil.ascSortLower(a.subclassShortName, b.subclassShortName) || SortUtil.ascSort(a.level, b.level) || SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source);
			}
			default: {
				return SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(SourceUtil.getEntitySource(a), SourceUtil.getEntitySource(b));
			}
		}
	}

	_addListItem ({displayName, hash, category, source, isAuto = false}) {
		const display = this._getDisplayValues(category, source);

		const id = this._listId++;
		const sourceFull = Parser.sourceJsonToFull(source);

		const btnRemove = isAuto
			? ee`<button class="ve-btn ve-btn-xxs ve-btn-danger" disabled title="This blocklist entry is automatically managed, and cannot be manually removed.">Remove</button>`
			: ee`<button class="ve-btn ve-btn-xxs ve-btn-danger">Remove</button>`
				.onn("click", () => {
					this._remove(id, hash, category, source);
				});

		const ele = ee`<div class="${this._addListItem_getItemStyles()}">
			<span class="ve-col-4 ve-text-center">${sourceFull}</span>
			<span class="ve-col-2 ve-text-center">${display.displayCategory}</span>
			<span class="ve-col-5 ve-text-center">${displayName}</span>
			<span class="ve-col-1 ve-text-center">${btnRemove}</span>
		</div>`;

		const listItem = new ListItem(
			id,
			ele,
			displayName,
			{
				category: display.displayCategory,
				source: sourceFull,
			},
			{
				displayName: displayName,
				hash: hash,
				category: category,
				source: source,
			},
		);

		this._list.addItem(listItem);
	}

	_addListItem_getItemStyles () { return `no-click ve-flex-v-center ve-lst__row ve-lst__row-border veapp__list-row ve-lst__row-inner ve-no-shrink`; }

	async _pAdd () {
		const {hash, name: displayName, category: categoryName} = this._comp.name;
		const category = categoryName === "*" ? this._comp.category : categoryName;

		if (
			this._comp.source === "*"
			&& category === "*"
			&& hash === "*"
			&& !await InputUiUtil.pGetUserBoolean({title: "Exclude All", htmlDescription: `This will exclude all content from all list pages. Are you sure?`, textYes: "Yes", textNo: "Cancel"})
		) return;

		if (this._addExclude(displayName, hash, category, this._comp.source)) {
			this._addListItem({displayName, hash, category, source: this._comp.source, isAuto: false});

			const subBlocklist = MiscUtil.get(this._subBlocklistEntries, category, hash);
			if (subBlocklist) {
				subBlocklist.forEach(it => {
					const {displayName, hash, category, source} = it;
					this._addExclude(displayName, hash, category, source);
					this._addListItem({displayName, hash, category, source, isAuto: false});
				});
			}

			this._list.update();
		}
	}

	/**
	 * @param {?Function} fnFilter
	 */
	_addMassSources ({fnFilter = null} = {}) {
		const sources = fnFilter
			? this._allSources.filter(source => fnFilter(source))
			: this._allSources;
		let changed = false;
		sources
			.forEach(source => {
				if (!this._addExclude("*", "*", "*", source, {isSkipPersist: true})) return;
				this._addListItem({displayName: "*", hash: "*", category: "*", source, isAuto: false});
				changed = true;
			});
		if (changed) this._pDoPersist().then(null);
		this._list.update();
	}

	/**
	 * @param {?Function} fnFilter
	 */
	_removeMassSources ({fnFilter = null} = {}) {
		const sources = fnFilter
			? this._allSources.filter(source => fnFilter(source))
			: this._allSources;
		let changed = false;
		sources
			.forEach(source => {
				const item = this._list.items.find(it => it.data.hash === "*" && it.data.category === "*" && it.data.source === source);
				if (!item) return;
				this._remove(item.ix, "*", "*", source, {isSkipListUpdate: true, isSkipPersist: true});
				changed = true;
			});
		if (changed) this._pDoPersist().then(null);
		this._list.update();
	}

	_addAllUa () { this._addMassSources({fnFilter: SourceUtil.isNonstandardSource}); }
	_removeAllUa () { this._removeMassSources({fnFilter: SourceUtil.isNonstandardSource}); }

	_addAllSources () { this._addMassSources(); }
	_removeAllSources () { this._removeMassSources(); }

	_addAllComedySources () { this._addMassSources({fnFilter: source => Parser.SOURCES_COMEDY.has(source)}); }
	_removeAllComedySources () { this._removeMassSources({fnFilter: source => Parser.SOURCES_COMEDY.has(source)}); }

	_addAllNonForgottenRealms () { this._addMassSources({fnFilter: source => Parser.SOURCES_NON_FR.has(source)}); }
	_removeAllNonForgottenRealms () { this._removeMassSources({fnFilter: source => Parser.SOURCES_NON_FR.has(source)}); }

	_addAllNonClassicSources () { this._addMassSources({fnFilter: source => SourceUtil.isClassicSource(source)}); }
	_removeAllClassicSources () { this._removeMassSources({fnFilter: source => SourceUtil.isClassicSource(source)}); }

	_addAllNonModernSources () { this._addMassSources({fnFilter: source => !SourceUtil.isClassicSource(source)}); }
	_removeAllModernSources () { this._removeMassSources({fnFilter: source => !SourceUtil.isClassicSource(source)}); }

	_addAllSW5eSources () { this._addMassSources({fnFilter: source => source.startsWith("sw5e")}); }
	_removeAllSW5eSources () { this._removeMassSources({fnFilter: source => source.startsWith("sw5e")}); }

	_addAllNonSW5eSources () {
		// Drop legacy PHB category wildcards; SW5e PHB packs replace core PHB for sw5e-only mode.
		this._removePHBPartialBlocklist({isSkipListUpdate: true, isSkipPersist: true});
		this._addMassSources({fnFilter: source => !source.startsWith("sw5e")});
	}
	_removeAllNonSW5eSources () {
		this._removeMassSources({fnFilter: source => !source.startsWith("sw5e")});
		this._removePHBPartialBlocklist({isSkipListUpdate: true, isSkipPersist: true});
		this._pDoPersist().then(null);
		this._list.update();
	}

	_getPHBPartialBlockCategories () {
		return (this._allCategories || [])
			.filter(category => !BlocklistUi._PHB_ALLOWED_CATEGORIES.has(category));
	}

	_addPHBPartialBlocklist () {
		// Drop stale category wildcards for allowed categories (e.g. after expanding the allowlist).
		this._removePHBPartialBlocklist({categoriesToRemove: BlocklistUi._PHB_ALLOWED_CATEGORIES, isSkipListUpdate: true});

		this._getPHBPartialBlockCategories()
			.forEach(category => {
				if (!this._addExclude("*", "*", category, BlocklistUi._PHB_SOURCE)) return;
				this._addListItem({
					displayName: "*",
					hash: "*",
					category,
					source: BlocklistUi._PHB_SOURCE,
					isAuto: false,
				});
			});
		this._list.update();
	}

	_removePHBPartialBlocklist ({categoriesToRemove = null, isSkipListUpdate = false, isSkipPersist = false} = {}) {
		const categories = categoriesToRemove == null
			? new Set(this._getPHBPartialBlockCategories())
			: new Set(categoriesToRemove);
		this._list.items
			.filter(it => (
				it.data.hash === "*"
				&& it.data.category !== "*"
				&& it.data.source === BlocklistUi._PHB_SOURCE
				&& categories.has(it.data.category)
			))
			.sort((a, b) => b.ix - a.ix)
			.forEach(it => this._remove(it.ix, "*", it.data.category, BlocklistUi._PHB_SOURCE, {isSkipListUpdate: true, isSkipPersist: true}));
		if (!isSkipPersist) this._pDoPersist().then(null);
		if (!isSkipListUpdate) this._list.update();
	}

	_addAllHomebrewSources () { this._addMassSources({fnFilter: source => BrewUtil2.getSources().map(s => s.json).includes(source)}); }
	_removeAllHomebrewSources () { this._removeMassSources({fnFilter: source => BrewUtil2.getSources().map(s => s.json).includes(source)}); }

	_remove (ix, hash, category, source, {isSkipListUpdate = false, isSkipPersist = false} = {}) {
		this._removeExclude(hash, category, source, {isSkipPersist});
		this._list.removeItemByIndex(ix);
		if (!isSkipListUpdate) this._list.update();
	}

	async _pDoSendToFoundry () {
		await ExtensionUtil.pDoSend({type: "5etools.blocklist.excludes", data: this._excludes.filter(excludeMeta => !excludeMeta.isAuto)});
	}

	_export () {
		DataUtil.userDownload(`content-blocklist`, {fileType: "content-blocklist", blocklist: this._excludes.filter(excludeMeta => !excludeMeta.isAuto)});
	}

	async _pImport_getUserUpload () {
		return InputUiUtil.pGetUserUploadJson({expectedFileTypes: ["content-blocklist", "content-blacklist"]}); // Supports old fileType "content-blacklist"
	}

	async _pImport (evt) {
		const {jsons, errors} = await this._pImport_getUserUpload();

		DataUtil.doHandleFileLoadErrorsGeneric(errors);

		if (!jsons?.length) return;

		// clear list display
		this._list.removeAllItems();
		this._list.update();

		const json = jsons[0];

		// update storage
		// Supports old key "blacklist"
		const importList = json.blocklist || json.blacklist || [];
		const nxtList = [
			...(
				evt.shiftKey
				// Supports old key "blacklist"
					? MiscUtil.copy(this._excludes).concat(importList)
					: importList
			),
			...this._excludes.filter(excludeMeta => excludeMeta.isAuto),
		];
		this._excludes = nxtList;
		this._pDoPersist(nxtList).then(null);

		// render list display
		this._renderList();
	}

	_reset () {
		this._resetExcludes();
		this._list.removeAllItems();
		this._renderList();
	}

	_refreshListFromStorage () {
		// Update the excludes from storage
		this._excludes = ExcludeUtil.getList();

		// Clear and re-render the list
		this._list.removeAllItems();
		this._renderList();
	}

	// Static methods for external use
	static async addSourcesFromFile (filePath) {
		await ExcludeUtil.pInitialise();

		try {
			const blocklistData = await DataUtil.loadJSON(filePath);
			const blocklist = blocklistData.blocklist || [];
			const listName = blocklistData._meta?.sources?.[0]?.full || "Default Blocklist";

			if (!blocklist.length) {
				JqueryUtil.doToast({type: "warning", content: "No blocklist entries found in the file."});
				return;
			}

			const currentExcludes = ExcludeUtil.getList();
			const newExcludes = [...currentExcludes, ...blocklist];
			await ExcludeUtil.pSetList(newExcludes);

			JqueryUtil.doToast({
				type: "success",
				content: `${listName}: ${blocklist.length} entries added to blocklist.`,
			});

			// Refresh if on blocklist page
			if (window.location.pathname === "/blocklist.html" || window.location.pathname.endsWith("blocklist.html")) {
				window.dispatchEvent(new Event("exclusionsChanged"));
			}
		} catch (error) {
			JqueryUtil.doToast({
				type: "danger",
				content: `Failed to load blocklist: ${error.message}`,
			});
		}
	}

	static async removeSourcesFromFile (filePath) {
		await ExcludeUtil.pInitialise();

		try {
			const blocklistData = await DataUtil.loadJSON(filePath);
			const blocklist = blocklistData.blocklist || [];
			const listName = blocklistData._meta?.sources?.[0]?.full || "Default Blocklist";

			if (!blocklist.length) {
				JqueryUtil.doToast({type: "warning", content: "No blocklist entries found in the file."});
				return;
			}

			const currentExcludes = ExcludeUtil.getList();
			const sourcesToRemove = new Set(blocklist.map(item => item.source));
			const newExcludes = currentExcludes.filter(ex => !sourcesToRemove.has(ex.source));
			const removedCount = currentExcludes.length - newExcludes.length;
			await ExcludeUtil.pSetList(newExcludes);

			JqueryUtil.doToast({
				type: "success",
				content: `${listName}: ${removedCount} entries removed from blocklist.`,
			});

			// Refresh if on blocklist page
			if (window.location.pathname === "/blocklist.html" || window.location.pathname.endsWith("blocklist.html")) {
				window.dispatchEvent(new Event("exclusionsChanged"));
			}
		} catch (error) {
			JqueryUtil.doToast({
				type: "danger",
				content: `Failed to load blocklist: ${error.message}`,
			});
		}
	}

	// Source toggle functionality (moved from navigation.js)
	static async addAllModernSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const modernSources = this._getEditionModernSources();

		const newExcludes = [...currentExcludes];
		let addedCount = 0;
		modernSources.forEach(source => {
			if (!currentExcludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				newExcludes.push({
					displayName: "*",
					hash: "*",
					category: "*",
					source: source,
				});
				addedCount++;
			}
		});
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `5.5e (&apos;24) Sources: ${addedCount} entries added to blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async removeAllModernSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const modernSources = new Set(this._getEditionModernSources());

		const newExcludes = currentExcludes.filter(ex =>
			!(ex.category === "*" && ex.hash === "*" && modernSources.has(ex.source)),
		);
		const removedCount = currentExcludes.length - newExcludes.length;
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `5.5e (&apos;24) Sources: ${removedCount} entries removed from blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async addAllClassicSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const classicSources = this._getEditionClassicSources();

		const newExcludes = [...currentExcludes];
		let addedCount = 0;
		classicSources.forEach(source => {
			if (!currentExcludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				newExcludes.push({
					displayName: "*",
					hash: "*",
					category: "*",
					source: source,
				});
				addedCount++;
			}
		});
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `5e (&apos;14) Sources: ${addedCount} entries added to blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async removeAllClassicSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const classicSources = new Set(this._getEditionClassicSources());

		const newExcludes = currentExcludes.filter(ex =>
			!(ex.category === "*" && ex.hash === "*" && classicSources.has(ex.source)),
		);
		const removedCount = currentExcludes.length - newExcludes.length;
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `5e (&apos;14) Sources: ${removedCount} entries removed from blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async addAllSW5eSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const sw5eSources = this._getSW5eSources();

		const newExcludes = [...currentExcludes];
		let addedCount = 0;
		sw5eSources.forEach(source => {
			if (!currentExcludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				newExcludes.push({
					displayName: "*",
					hash: "*",
					category: "*",
					source: source,
				});
				addedCount++;
			}
		});
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `Star Wars Sources: ${addedCount} entries added to blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async removeAllSW5eSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();

		const newExcludes = currentExcludes.filter(ex =>
			!(ex.category === "*" && ex.hash === "*" && ex.source?.startsWith("sw5e")),
		);
		const removedCount = currentExcludes.length - newExcludes.length;

		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `Star Wars Sources: ${removedCount} entries removed from blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async addAllNonSW5eSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		let currentExcludes = this._mutRemoveLegacyPHBPartialExcludes(ExcludeUtil.getList());
		const nonSw5eSources = this._getNonSW5eSources();

		const newExcludes = [...currentExcludes];
		let addedCount = 0;
		nonSw5eSources.forEach(source => {
			if (!currentExcludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				newExcludes.push({
					displayName: "*",
					hash: "*",
					category: "*",
					source: source,
				});
				addedCount++;
			}
		});
		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `Non-Star Wars Sources: ${addedCount} entries added to blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static async removeAllNonSW5eSources () {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const currentExcludes = ExcludeUtil.getList();
		const nonSw5eSources = new Set(this._getNonSW5eSources());

		const newExcludes = currentExcludes.filter(ex => {
			if (ex.category === "*" && ex.hash === "*" && nonSw5eSources.has(ex.source)) return false;
			return !this._isLegacyPHBPartialExclude(ex);
		});
		const removedCount = currentExcludes.length - newExcludes.length;

		await ExcludeUtil.pSetList(newExcludes);

		JqueryUtil.doToast({
			type: "success",
			content: `Non-Star Wars Sources: ${removedCount} entries removed from blocklist.`,
		});

		this._pNotifyExclusionsChanged();
	}

	static _pNotifyExclusionsChanged () {
		if (window.location.pathname === "/blocklist.html" || window.location.pathname.endsWith("blocklist.html")) {
			window.dispatchEvent(new Event("exclusionsChanged"));
			return;
		}
		window.location.reload();
	}

	static async _pInitBrewSources () {
		if (typeof BrewUtil2 !== "undefined") await BrewUtil2.pInit();
		if (typeof PrereleaseUtil !== "undefined" && PrereleaseUtil.pInit) await PrereleaseUtil.pInit();
	}

	static _isLegacyPHBPartialExclude (ex) {
		return ex.source === BlocklistUi._PHB_SOURCE && ex.hash === "*" && ex.category !== "*";
	}

	static _mutRemoveLegacyPHBPartialExcludes (excludes) {
		return excludes.filter(ex => !this._isLegacyPHBPartialExclude(ex));
	}

	// Helper methods for source filtering
	static _getAllCatalogSources () {
		const sources = new Set(Object.keys(Parser.SOURCE_JSON_TO_DATE));
		if (typeof BrewUtil2 !== "undefined") {
			BrewUtil2.getSources().map(s => s.json).forEach(source => sources.add(source));
		}
		if (typeof PrereleaseUtil !== "undefined" && PrereleaseUtil.getSources) {
			PrereleaseUtil.getSources().map(s => s.json).forEach(source => sources.add(source));
		}
		return [...sources];
	}

	static _getClassicSources () {
		return this._getAllCatalogSources().filter(source => SourceUtil.isClassicSource(source));
	}

	static _getModernSources () {
		return this._getAllCatalogSources().filter(source => !SourceUtil.isClassicSource(source));
	}

	/** Classic/modern lists for edition mode (excludes Star Wars homebrew). */
	static _getEditionClassicSources () {
		return this._getClassicSources().filter(source => !source.startsWith("sw5e"));
	}

	static _getEditionModernSources () {
		return this._getModernSources().filter(source => !source.startsWith("sw5e"));
	}

	/** @deprecated Use {@link BlocklistUi._getModernSources} */
	static _get2024Sources () { return this._getModernSources(); }

	static _getSW5eSources () {
		const sources = new Set();
		if (typeof BrewUtil2 !== "undefined") {
			BrewUtil2.getSources()
				.map(s => s.json)
				.filter(source => source.startsWith("sw5e"))
				.forEach(source => sources.add(source));
		}
		ExcludeUtil.getList()
			.filter(ex => ex.source?.startsWith("sw5e"))
			.forEach(ex => sources.add(ex.source));
		return [...sources];
	}

	static _getNonSW5eSources () {
		const sources = new Set(Object.keys(Parser.SOURCE_JSON_TO_DATE));
		if (typeof BrewUtil2 !== "undefined") {
			BrewUtil2.getSources().map(s => s.json).forEach(source => sources.add(source));
		}
		if (typeof PrereleaseUtil !== "undefined" && PrereleaseUtil.getSources) {
			PrereleaseUtil.getSources().map(s => s.json).forEach(source => sources.add(source));
		}
		return [...sources].filter(source => !source.startsWith("sw5e"));
	}

	/** Block all non-SW5e sources and unblock all SW5e sources (single persist). */
	static async applySw5eMode ({isSilent = false} = {}) {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		let excludes = this._mutRemoveLegacyPHBPartialExcludes(ExcludeUtil.getList());
		excludes = excludes.filter(ex =>
			!(ex.category === "*" && ex.hash === "*" && ex.source?.startsWith("sw5e")),
		);

		const nonSw5eSources = this._getNonSW5eSources();
		nonSw5eSources.forEach(source => {
			if (!excludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				excludes.push({displayName: "*", hash: "*", category: "*", source});
			}
		});

		await ExcludeUtil.pSetList(excludes);

		if (!isSilent) {
			JqueryUtil.doToast({type: "success", content: "Star Wars mode: non-Star Wars sources blocked."});
		}
	}

	/** Unblock all non-SW5e sources and block all SW5e sources (single persist). */
	static async applyDndMode ({isSilent = false} = {}) {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const nonSw5eSources = new Set(this._getNonSW5eSources());
		let excludes = ExcludeUtil.getList().filter(ex => {
			if (ex.category === "*" && ex.hash === "*" && nonSw5eSources.has(ex.source)) return false;
			return !this._isLegacyPHBPartialExclude(ex);
		});

		const sw5eSources = new Set(this._getSW5eSources());
		ExcludeUtil.getList()
			.map(ex => ex.source)
			.filter(source => source?.startsWith("sw5e"))
			.forEach(source => sw5eSources.add(source));

		sw5eSources.forEach(source => {
			if (!excludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				excludes.push({displayName: "*", hash: "*", category: "*", source});
			}
		});

		await ExcludeUtil.pSetList(excludes);

		if (!isSilent) {
			JqueryUtil.doToast({type: "success", content: "D&D mode: Star Wars sources blocked."});
		}
	}

	/** Block all modern (5.5e) sources and unblock all classic (5e) sources (single persist). */
	static async apply5eMode ({isSilent = false} = {}) {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const classicSources = new Set(this._getEditionClassicSources());
		let excludes = ExcludeUtil.getList().filter(ex => {
			if (ex.category === "*" && ex.hash === "*" && classicSources.has(ex.source)) return false;
			return !this._isLegacyPHBPartialExclude(ex);
		});

		this._getEditionModernSources().forEach(source => {
			if (!excludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				excludes.push({displayName: "*", hash: "*", category: "*", source});
			}
		});

		await ExcludeUtil.pSetList(excludes);

		if (!isSilent) {
			JqueryUtil.doToast({type: "success", content: "5e mode: 5.5e sources blocked."});
		}
	}

	/** Block all classic (5e) sources and unblock all modern (5.5e) sources (single persist). */
	static async apply55eMode ({isSilent = false} = {}) {
		await ExcludeUtil.pInitialise();
		await this._pInitBrewSources();

		const modernSources = new Set(this._getEditionModernSources());
		let excludes = ExcludeUtil.getList().filter(ex => {
			if (ex.category === "*" && ex.hash === "*" && modernSources.has(ex.source)) return false;
			return !this._isLegacyPHBPartialExclude(ex);
		});

		this._getEditionClassicSources().forEach(source => {
			if (!excludes.find(ex => ex.source === source && ex.category === "*" && ex.hash === "*")) {
				excludes.push({displayName: "*", hash: "*", category: "*", source});
			}
		});

		await ExcludeUtil.pSetList(excludes);

		if (!isSilent) {
			JqueryUtil.doToast({type: "success", content: "5.5e mode: 5e sources blocked."});
		}
	}
}

globalThis.BlocklistUi = BlocklistUi;

BlocklistUi.Component = class extends BaseComponent {
	constructor () {
		super();

		const hkNonNameChange = () => {
			this._state.name = {hash: "*", name: "*", category: this._state.category};
		};
		this._addHookBase("source", hkNonNameChange);
		this._addHookBase("category", hkNonNameChange);
	}

	get source () { return this._state.source; }
	get category () { return this._state.category; }
	get name () { return this._state.name; }

	addHook (prop, hk) { return this._addHookBase(prop, hk); }

	_getDefaultState () {
		return {
			source: "*",
			category: "*",
			name: {
				hash: "*",
				name: "*",
				category: "*",
			},
		};
	}
};

/**
 * Site-wide Star Wars vs D&D content mode.
 * Adds `ve-content-mode-sw5e` or `ve-content-mode-dnd` on `<html>`.
 */
class ContentMode {
	static MODE_DND = "dnd";
	static MODE_SW5E = "sw5e";

	static _CLASS_PREFIX = "ve-content-mode-";

	/** While applying a mode via the nav toggle; skip blocklist-driven sync. */
	static _isApplyingMode = false;

	static getMode () {
		const stored = StorageUtil.syncGet(VeCt.STORAGE_CONTENT_MODE);
		if (stored === this.MODE_SW5E || stored === this.MODE_DND) return stored;
		return this.MODE_DND;
	}

	static syncApplyDocumentClass (mode = null) {
		mode ||= this.getMode();
		const root = document.documentElement;
		root.classList.remove(`${this._CLASS_PREFIX}${this.MODE_DND}`, `${this._CLASS_PREFIX}${this.MODE_SW5E}`);
		root.classList.add(`${this._CLASS_PREFIX}${mode}`);
		window.dispatchEvent(new CustomEvent("contentModeChanged", {detail: {mode}}));
	}

	static async pInitialise () {
		await ExcludeUtil.pInitialise();
		await BlocklistUi._pInitBrewSources();

		const inferred = await this._pInferModeFromBlocklist();
		let mode = StorageUtil.syncGet(VeCt.STORAGE_CONTENT_MODE);

		if (inferred != null) mode = inferred;
		else if (mode !== this.MODE_SW5E && mode !== this.MODE_DND) mode = this.MODE_DND;

		StorageUtil.syncSet(VeCt.STORAGE_CONTENT_MODE, mode);
		await StorageUtil.pSet(VeCt.STORAGE_CONTENT_MODE, mode);
		this.syncApplyDocumentClass(mode);
	}

	static async pSetMode (mode) {
		if (mode !== this.MODE_DND && mode !== this.MODE_SW5E) {
			throw new Error(`Unhandled content mode "${mode}"`);
		}

		this._isApplyingMode = true;
		try {
			StorageUtil.syncSet(VeCt.STORAGE_CONTENT_MODE, mode);
			await StorageUtil.pSet(VeCt.STORAGE_CONTENT_MODE, mode);
			this.syncApplyDocumentClass(mode);

			if (mode === this.MODE_SW5E) await BlocklistUi.applySw5eMode({isSilent: true});
			else await BlocklistUi.applyDndMode({isSilent: true});

			JqueryUtil.doToast({
				type: "success",
				content: mode === this.MODE_SW5E ? "Star Wars mode enabled." : "D&D mode enabled.",
			});

			BlocklistUi._pNotifyExclusionsChanged();
		} finally {
			this._isApplyingMode = false;
		}
	}

	/**
	 * If the blocklist matches a full Star Wars or D&D preset, update storage and the document class.
	 * Does nothing for custom/partial blocklists.
	 */
	static async pSyncFromBlocklist () {
		if (this._isApplyingMode) return;

		const inferred = await this._pInferModeFromBlocklist();
		if (inferred == null) return;

		const cur = this.getMode();
		if (cur === inferred) {
			if (!document.documentElement.classList.contains(`${this._CLASS_PREFIX}${inferred}`)) {
				this.syncApplyDocumentClass(inferred);
			}
			return;
		}

		StorageUtil.syncSet(VeCt.STORAGE_CONTENT_MODE, inferred);
		await StorageUtil.pSet(VeCt.STORAGE_CONTENT_MODE, inferred);
		this.syncApplyDocumentClass(inferred);
	}

	static async _pInferModeFromBlocklist () {
		if (!ExcludeUtil.isInitialised) await ExcludeUtil.pInitialise();
		await BlocklistUi._pInitBrewSources();

		const wildcards = ExcludeUtil.getList()
			.filter(ex => !ex.isAuto && ex.category === "*" && ex.hash === "*");

		const blockedNonSw5e = wildcards.filter(ex => !ex.source?.startsWith("sw5e"));
		const blockedSw5e = wildcards.filter(ex => ex.source?.startsWith("sw5e"));

		// D&D preset: Star Wars sources blocked, no full-source blocks on other content.
		if (blockedSw5e.length > 0 && blockedNonSw5e.length === 0) return this.MODE_DND;

		// Star Wars preset: non-Star Wars sources blocked, no Star Wars full-source blocks.
		if (blockedNonSw5e.length > 0 && blockedSw5e.length === 0) return this.MODE_SW5E;

		return null;
	}
}

globalThis.ContentMode = ContentMode;

ContentMode.syncApplyDocumentClass();
window.addEventListener("DOMContentLoaded", () => ContentMode.pInitialise().then(null));
window.addEventListener("exclusionsChanged", () => ContentMode.pSyncFromBlocklist().then(null));

/**
 * Site-wide 5e (2014) vs 5.5e (2024) edition mode.
 * Adds `ve-edition-mode-5e` or `ve-edition-mode-55e` on `<html>`.
 */
class EditionMode {
	static MODE_5E = "5e";
	static MODE_55E = "55e";

	static _CLASS_PREFIX = "ve-edition-mode-";

	/** While applying a mode via the nav toggle; skip blocklist-driven sync. */
	static _isApplyingMode = false;

	static _isEditionRelevantSource (source) {
		return source && !source.startsWith("sw5e");
	}

	static getMode () {
		const stored = StorageUtil.syncGet(VeCt.STORAGE_EDITION_MODE);
		if (stored === this.MODE_5E || stored === this.MODE_55E) return stored;
		return this.MODE_5E;
	}

	static syncApplyDocumentClass (mode = null) {
		mode ||= this.getMode();
		const root = document.documentElement;
		root.classList.remove(`${this._CLASS_PREFIX}${this.MODE_5E}`, `${this._CLASS_PREFIX}${this.MODE_55E}`);
		root.classList.add(`${this._CLASS_PREFIX}${mode}`);
		window.dispatchEvent(new CustomEvent("editionModeChanged", {detail: {mode}}));
	}

	static async pInitialise () {
		await ExcludeUtil.pInitialise();
		await BlocklistUi._pInitBrewSources();

		const inferred = await this._pInferModeFromBlocklist();
		let mode = StorageUtil.syncGet(VeCt.STORAGE_EDITION_MODE);

		if (inferred != null) mode = inferred;
		else if (mode !== this.MODE_5E && mode !== this.MODE_55E) mode = this.MODE_5E;

		StorageUtil.syncSet(VeCt.STORAGE_EDITION_MODE, mode);
		await StorageUtil.pSet(VeCt.STORAGE_EDITION_MODE, mode);
		this.syncApplyDocumentClass(mode);
	}

	static async pSetMode (mode) {
		if (mode !== this.MODE_5E && mode !== this.MODE_55E) {
			throw new Error(`Unhandled edition mode "${mode}"`);
		}

		this._isApplyingMode = true;
		try {
			StorageUtil.syncSet(VeCt.STORAGE_EDITION_MODE, mode);
			await StorageUtil.pSet(VeCt.STORAGE_EDITION_MODE, mode);
			this.syncApplyDocumentClass(mode);

			if (mode === this.MODE_5E) await BlocklistUi.apply5eMode({isSilent: true});
			else await BlocklistUi.apply55eMode({isSilent: true});

			JqueryUtil.doToast({
				type: "success",
				content: mode === this.MODE_5E ? "5e mode enabled." : "5.5e mode enabled.",
			});

			BlocklistUi._pNotifyExclusionsChanged();
		} finally {
			this._isApplyingMode = false;
		}
	}

	/**
	 * If the blocklist matches a full 5e or 5.5e preset, update storage and the document class.
	 * Does nothing for custom/partial blocklists.
	 */
	static async pSyncFromBlocklist () {
		if (this._isApplyingMode) return;

		const inferred = await this._pInferModeFromBlocklist();
		if (inferred == null) return;

		const cur = this.getMode();
		if (cur === inferred) {
			if (!document.documentElement.classList.contains(`${this._CLASS_PREFIX}${inferred}`)) {
				this.syncApplyDocumentClass(inferred);
			}
			return;
		}

		StorageUtil.syncSet(VeCt.STORAGE_EDITION_MODE, inferred);
		await StorageUtil.pSet(VeCt.STORAGE_EDITION_MODE, inferred);
		this.syncApplyDocumentClass(inferred);
	}

	static async _pInferModeFromBlocklist () {
		if (!ExcludeUtil.isInitialised) await ExcludeUtil.pInitialise();
		await BlocklistUi._pInitBrewSources();

		const wildcards = ExcludeUtil.getList()
			.filter(ex => !ex.isAuto && ex.category === "*" && ex.hash === "*")
			.filter(ex => this._isEditionRelevantSource(ex.source));

		const blockedModern = wildcards.filter(ex => !SourceUtil.isClassicSource(ex.source));
		const blockedClassic = wildcards.filter(ex => SourceUtil.isClassicSource(ex.source));

		// 5e preset: modern sources blocked, no classic full-source blocks.
		if (blockedModern.length > 0 && blockedClassic.length === 0) return this.MODE_5E;

		// 5.5e preset: classic sources blocked, no modern full-source blocks.
		if (blockedClassic.length > 0 && blockedModern.length === 0) return this.MODE_55E;

		return null;
	}
}

globalThis.EditionMode = EditionMode;

EditionMode.syncApplyDocumentClass();
window.addEventListener("DOMContentLoaded", () => EditionMode.pInitialise().then(null));
window.addEventListener("exclusionsChanged", () => EditionMode.pSyncFromBlocklist().then(null));
