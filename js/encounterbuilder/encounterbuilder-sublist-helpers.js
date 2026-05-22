import {EncounterBuilderCreatureMeta} from "./encounterbuilder-models.js";

export class EncounterBuilderHelpers {
	static getSublistedCreatureMeta ({sublistItem}) {
		const mon = sublistItem.data.entityBase;

		return new EncounterBuilderCreatureMeta({
			id: sublistItem.data.collectionId,

			creature: sublistItem.data.entity,
			count: Number(sublistItem.data.count),

			isLocked: sublistItem.data.isLocked,

			customHashId: sublistItem.data.customHashId,
			baseCreature: mon,
		});
	}

	static async pGetEncounterName (exportedSublist) {
		if (exportedSublist.name) return exportedSublist.name;

		const expandedList = await ListUtil.pGetSublistEntities_fromHover({
			exportedSublist,
			page: UrlUtil.PG_BESTIARY,
		});

		if (!expandedList?.length) return "(Unnamed Encounter)";

		const {count, entity: {name}} = expandedList
			.sort((a, b) => SortUtil.ascSort(b.count, a.count) || SortUtil.ascSort(b.entity.name, a.entity.name))[0];

		return `Encounter with ${name}${count > 1 ? ` ×${count}` : ""}`;
	}
}
