const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { a, div, pre } = require("@saltcorn/markup/tags");

class GenerateTrigger {
  static title = "Generate Trigger";
  static function_name = "generate_trigger";
  static description =
    "Generate a Saltcorn trigger with any available action type";

  static render_html({
    action_name,
    action_type,
    when_trigger,
    trigger_table,
    action_config,
  }) {
    const summary =
      `<strong>${action_name}</strong> — ${action_type}` +
      (when_trigger ? `: ${when_trigger}` : "") +
      (trigger_table ? ` on ${trigger_table}` : "");
    const configSection =
      action_config && Object.keys(action_config).length
        ? pre({ class: "mt-2" }, JSON.stringify(action_config, null, 2))
        : "";
    return div({ class: "mb-3" }, summary) + configSection;
  }

  static async execute(
    { action_name, action_type, when_trigger, trigger_table, action_config },
    req,
  ) {
    let table_id;
    if (trigger_table) {
      const table = Table.findOne({ name: trigger_table });
      if (!table) return { postExec: `Table not found: ${trigger_table}` };
      table_id = table.id;
    }
    const trigger = await Trigger.create({
      name: action_name,
      when_trigger: when_trigger || "Never",
      table_id,
      action: action_type,
      configuration: action_config || {},
    });
    Trigger.emitEvent("AppChange", `Trigger ${trigger.name}`, req?.user, {
      entity_type: "Trigger",
      entity_name: trigger.name,
    });
    return {
      postExec:
        "Trigger created. " +
        a(
          { target: "_blank", href: `/actions/configure/${trigger.id}` },
          "Configure trigger.",
        ),
    };
  }
}

module.exports = GenerateTrigger;
