/** Patches Renderer cache helpers used by adventure encounter blocks (keeps render.js diff minimal). */
export function patchRendererEncounterBootstrap () {
	if (!globalThis.Renderer?._cache) return;
	if (Renderer._cache.__encounterBlockBootstrapPatched) return;
	Renderer._cache.__encounterBlockBootstrapPatched = true;

	Renderer._cache.encounter = Renderer._cache.encounter || {};

	const origPRunFromEle = Renderer._cache.pRunFromEle.bind(Renderer._cache);
	Renderer._cache.pRunFromEle = async function (ele) {
		const cacheType = ele.dataset.rdCache;
		const cacheId = ele.dataset.rdCacheId;
		const cached = Renderer._cache[cacheType]?.[cacheId];
		if (!cached?.pFn || cached._isRun) return;
		cached._isRun = true;
		await cached.pFn(ele);
	};

	Renderer._cache.pRunAllPendingFromRoot = async function (rootEle = document) {
		const eles = [...rootEle.querySelectorAll("style[data-rd-cache][data-rd-cache-id]")];
		await eles.pSerialAwaitMap(ele => Renderer._cache.pRunFromEle(ele));
	};
}
