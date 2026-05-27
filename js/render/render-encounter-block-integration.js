/** Adventure encounter block ↔ bestiary integration patches (keeps core files merge-friendly). */
export function patchEncounterBlockIntegrations ({BestiarySublistManager} = {}) {
	patchSublistManagerEncounterBlock();
	if (BestiarySublistManager) patchBestiarySublistManagerEncounterBlock(BestiarySublistManager);
}

function patchSublistManagerEncounterBlock () {
	const proto = globalThis.SublistManager?.prototype;
	if (!proto?.pSetFromSubHashes || proto.pSetFromSubHashes.__encounterBlockPatched) return;

	const origPSetFromSubHashes = proto.pSetFromSubHashes;
	proto.pSetFromSubHashes = async function (subHashes, pFnPreLoad) {
		const unpacked = {};
		subHashes.forEach(s => {
			const unpackedPart = UrlUtil.unpackSubHash(s, true);
			if (Object.keys(unpackedPart).length > 1) throw new Error(`Multiple keys in subhash!`);
			const k = Object.keys(unpackedPart)[0];
			unpackedPart[k] = {clean: unpackedPart[k], raw: s};
			Object.assign(unpacked, unpackedPart);
		});

		const encounterBlockEdit = unpacked.encounterblockedit?.clean;
		if (encounterBlockEdit?.[0]) {
			const {EncounterBlockBestiaryBridge} = await import("./render-encounter-block.js");
			await EncounterBlockBestiaryBridge.pMutSetFromSubHashes({unpacked, sublistManager: this, pFnPreLoad});
			return Object.entries(unpacked)
				.filter(([k]) => k !== this.constructor._SUB_HASH_PREFIX && k !== "encounterblockedit")
				.map(([, v]) => v.raw);
		}

		return origPSetFromSubHashes.call(this, subHashes, pFnPreLoad);
	};
	proto.pSetFromSubHashes.__encounterBlockPatched = true;
}

function patchBestiarySublistManagerEncounterBlock (BestiarySublistManager) {
	const cls = BestiarySublistManager;
	if (!cls?.prototype || cls.prototype._fnRenderSaveSummaryExtra?.__encounterBlockPatched) return;

	cls.prototype._fnRenderSaveSummaryExtra = async function ({save, comp, wrp, hkRefresh}) {
		const {EncounterBlockBestiaryBridge} = await import("./render-encounter-block.js");
		await EncounterBlockBestiaryBridge.pRenderSaveSummaryAdventureLinks({save, comp, wrp, hkRefresh});
		this.doUpdateSublistVisibility?.();
	};
	cls.prototype._fnRenderSaveSummaryExtra.__encounterBlockPatched = true;
}
