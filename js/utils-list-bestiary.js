import {EncounterBuilderComponentBestiary} from "./bestiary/bestiary-encounterbuilder-component.js";
import {EncounterBuilderHelpers} from "./encounterbuilder/encounterbuilder-sublist-helpers.js";

export {EncounterBuilderHelpers};

export class ListUtilBestiary extends ListUtilEntity {
	static _getString_action_currentPinned_name ({page}) { return "From Current Bestiary Encounter"; }
	static _getString_action_savedPinned_name ({page}) { return "From Saved Bestiary Encounter"; }
	static _getString_action_file_name ({page}) { return "From Bestiary Encounter File"; }

	static _getString_action_currentPinned_msg_noSaved ({page}) { return "No saved encounter! Please first go to the Bestiary and create one."; }
	static _getString_action_savedPinned_msg_noSaved ({page}) { return "No saved encounters were found! Go to the Bestiary and create some first."; }

	static async _pGetLoadableSublist_getAdditionalState ({exportedSublist}) {
		const encounterInfo = EncounterBuilderComponentBestiary.getStateFromExportedSublist({exportedSublist});
		return {encounterInfo};
	}

	static async pGetLoadableSublist (opts) {
		return super.pGetLoadableSublist({...opts, page: UrlUtil.PG_BESTIARY});
	}

	static _getFileTypes ({page}) {
		return [
			...super._getFileTypes({page}),
			"encounter",
		];
	}

	static getContextOptionsLoadSublist (opts) {
		return super.getContextOptionsLoadSublist({...opts, page: UrlUtil.PG_BESTIARY});
	}
}
