import {EncounterBuilderComponent} from "../encounterbuilder/encounterbuilder-component.js";

export class EncounterBuilderComponentBestiary extends EncounterBuilderComponent {
	getSublistPluginState () {
		return {
			// region Special handling for `creatureMetas`
			items: this._state.creatureMetas
				.map(creatureMeta => {
					const creature = creatureMeta.getCreature();
					const baseCreature = creatureMeta.entity.baseCreature;
					const hashEntity = baseCreature || creature;
					const baseName = baseCreature?.name || creature.name;

					const item = {
						h: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](hashEntity),
						c: creatureMeta.getCount(),
						customHashId: creatureMeta.getCustomHashId(),
						cId: creatureMeta.id,
						l: creatureMeta.getIsLocked(),
					};

					const displayName = creature._displayName
						|| (creature.name?.toLowerCase() !== baseName?.toLowerCase() ? creature.name : "");
					if (displayName && displayName.toLowerCase() !== baseName?.toLowerCase()) item.dn = displayName;

					return item;
				}),
			sources: this._state.creatureMetas
				.map(creatureMeta => creatureMeta.getCreature().source)
				.unique(),
			// endregion

			...Object.fromEntries(
				Object.entries(this._state)
					.filter(([k]) => k !== "creatureMetas")
					.map(([k, v]) => [k, MiscUtil.copyFast(v)]),
			),
		};
	}

	/** Get a generic representation of the encounter, which can be used elsewhere. */
	static getStateFromExportedSublist ({exportedSublist}) {
		exportedSublist = MiscUtil.copyFast(exportedSublist);

		const out = this._getDefaultState();
		Object.keys(out)
			.filter(k => exportedSublist[k] != null)
			.forEach(k => out[k] = exportedSublist[k]);
		return out;
	}
}
