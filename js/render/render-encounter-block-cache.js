import {EncounterBuilderCacheBase} from "../encounterbuilder/cache/encounterbuilder-cache-base.js";

/** Encounter builder creature cache for adventure encounter blocks (no bestiary list page required). */
export class EncounterBuilderCacheAdventure extends EncounterBuilderCacheBase {
	_cacheXp = null;
	_cacheCr = null;

	reset () {
		this._cacheXp = null;
		this._cacheCr = null;
	}

	async _pEnsureCaches () {
		if (this._cacheXp != null && this._cacheCr != null) return;

		const allMons = [
			...(await DataLoader.pCacheAndGetAllSite("monster")),
			...(await DataLoader.pCacheAndGetAllBrew("monster")),
			...(await DataLoader.pCacheAndGetAllPrerelease("monster")),
		];

		const cacheXp = {};
		const cacheCr = {};

		allMons
			.filter(mon => !this._isUnwantedCreature(mon))
			.forEach(mon => {
				(cacheXp[Parser.crToXpNumber(mon.cr)] ||= []).push(mon);
				(cacheCr[Parser.crToNumber(mon.cr)] ||= []).push(mon);
			});

		this._cacheXp = cacheXp;
		this._cacheCr = cacheCr;
	}

	_doBuildCaches () {
		throw new Error("Use async pEnsureCaches for adventure encounter builder cache!");
	}

	async pEnsureCaches () {
		await this._pEnsureCaches();
	}

	_getCreaturesByXp (spendValue) {
		return this._cacheXp?.[spendValue] || [];
	}

	_getKeysByXp () {
		return Object.keys(this._cacheXp || {}).map(Number);
	}

	_getCreaturesByCr (spendValue) {
		return this._cacheCr?.[spendValue] || [];
	}

	_getKeysByCr () {
		return Object.keys(this._cacheCr || {}).map(Number).sort(SortUtil.ascSort);
	}

	getCreatures ({budgetMode, spendValue, isPreferNonSingleton = false}) {
		if (this._cacheXp == null) return [];
		return super.getCreatures({budgetMode, spendValue, isPreferNonSingleton});
	}
}
