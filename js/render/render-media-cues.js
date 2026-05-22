/** @cue tag handling for media/DM slide cues (extracted from render.js). */
export class RendererMediaCues {
	static handleCueTag (renderer, {text, textStack, meta}) {
		let [toDisplay, color] = Renderer.splitTagByPipe(text);
		const ptColor = renderer._renderString_renderTag_getCueColorPart(color);
		const isMediaAction = color === "media-action" || color === "media";
		let slideNum = null;
		let extraAttrs = "";
		if (isMediaAction) {
			const slideMatch = toDisplay.match(/Load\sImage\s#(\d+)/i);
			if (slideMatch) {
				slideNum = parseInt(slideMatch[1], 10);
				extraAttrs = ` class="media-action-cue" data-slide-num="${slideNum}" title="Click to cue slide #${slideNum}"`;
			}
		}
		textStack[0] += `<i class="ve-dm-action${slideNum ? " media-action-cue" : ""}" style="color: ${ptColor}${slideNum ? "; cursor: pointer;" : ""}"${extraAttrs}>`;
		renderer._recursiveRender(toDisplay, textStack, meta);
		textStack[0] += `</i>`;
	}
}

globalThis.RendererMediaCues = RendererMediaCues;
