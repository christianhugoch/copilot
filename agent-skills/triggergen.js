const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getState } = require("@saltcorn/data/db/state");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { fieldProperties } = require("../common");
const GenerateAnyAction = require("../actions/generate-trigger");

const flattenOptionGroups = (options = []) =>
  options.flatMap((opt) =>
    opt?.optgroup && Array.isArray(opt.options) ? opt.options : [opt],
  );

class AnyActionSkill {
  static skill_name = "Generate trigger";

  get skill_label() {
    return "Generate trigger";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return (
      `If the user asks to create an action or trigger, use the generate_trigger tool. ` +
      `Pick the most appropriate action_type from the available options. ` +
      `Only set when_trigger and trigger_table if the user has specified them.`
    );
  }

  get userActions() {
    return {
      async build_copilot_any_action(input) {
        const {
          name,
          action_type,
          when_trigger,
          trigger_table,
          action_config,
          user,
        } = input;
        if (!name || !action_type) {
          return { notify: "Action name and type are required." };
        }
        const result = await GenerateAnyAction.execute(
          {
            action_name: name,
            action_type,
            when_trigger,
            trigger_table,
            action_config,
          },
          { user },
        );
        return { notify: result?.postExec || `Action saved: ${name}` };
      },
    };
  }

  provideTools = () => {
    const state = getState();
    const allActionOptions = (() => {
      try {
        return (
          Trigger.action_options({ notRequireRow: false, workflow: false }) ||
          []
        );
      } catch (_) {
        return [];
      }
    })();
    const stateActions = state?.actions || {};
    const stateActionNames = Object.keys(stateActions);
    const catalogNames = flattenOptionGroups(allActionOptions);
    const actionEnum = Array.from(
      new Set([...catalogNames, ...stateActionNames]),
    ).sort();

    const tables = (state.tables || []).map((t) => t.name);

    return {
      type: "function",
      function: {
        name: GenerateAnyAction.function_name,
        description: GenerateAnyAction.description,
        parameters: {
          type: "object",
          required: ["name", "action_type"],
          properties: {
            name: {
              type: "string",
              description:
                "A human-readable name for the trigger/action (1–5 words).",
            },
            action_type: {
              type: "string",
              enum: actionEnum.length ? actionEnum : undefined,
              description: "The action to run when the trigger fires.",
            },
            when_trigger: {
              type: "string",
              enum: Trigger.when_options,
              description:
                "When to fire this trigger. Only set if the user has specified. Leave unset for manual/API-call triggers.",
            },
            trigger_table: {
              type: "string",
              enum: tables,
              description:
                "Table for row-level triggers (Insert/Update/Delete/Validate). Only set when when_trigger requires a table.",
            },
          },
        },
      },
      process: async (input) => {
        const { name, action_type, when_trigger, trigger_table } = input || {};
        return [
          `Generating ${action_type} action: ${name}.`,
          when_trigger ? `Trigger: ${when_trigger}` : null,
          trigger_table ? `Table: ${trigger_table}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      },
      postProcess: async ({ tool_call, generate }) => {
        const { name, action_type, when_trigger, trigger_table } =
          tool_call.input || {};
        if (!name || !action_type) {
          return {
            stop: true,
            add_response: "Action name and type are required.",
          };
        }

        const stateAction = getState()?.actions?.[action_type];
        let action_config = {};

        if (stateAction) {
          const table = trigger_table
            ? Table.findOne({ name: trigger_table })
            : null;
          let cfgFields = [];
          try {
            cfgFields = await getActionConfigFields(stateAction, table, {
              copilot: true,
            });
          } catch (_) {}

          const configurable = cfgFields.filter(
            (f) => f.input_type !== "section_header",
          );
          if (configurable.length > 0) {
            const properties = {};
            for (const f of configurable) {
              properties[f.name] = {
                description: f.sublabel || f.label || f.name,
                ...fieldProperties(f),
              };
              if (!properties[f.name].type) properties[f.name].type = "string";
            }

            const answer = await generate(
              `Configure the "${action_type}" action named "${name}". ` +
                `Fill in the configuration by calling the generate_action_config tool.`,
              {
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "generate_action_config",
                      description: `Provide configuration fields for the ${action_type} action`,
                      parameters: { type: "object", properties },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: { name: "generate_action_config" },
                },
              },
            );

            const tc = answer.getToolCalls()[0];
            if (tc?.input) action_config = tc.input;
          }
        }

        if (this.yoloMode) {
          const result = await GenerateAnyAction.execute(
            {
              action_name: name,
              action_type,
              when_trigger,
              trigger_table,
              action_config,
            },
            {},
          );
          return {
            stop: true,
            add_response: result?.postExec || `Action ${name} created.`,
          };
        }

        return {
          stop: true,
          add_response: GenerateAnyAction.render_html({
            action_name: name,
            action_type,
            when_trigger,
            trigger_table,
            action_config,
          }),
          add_user_action: {
            name: "build_copilot_any_action",
            type: "button",
            label: `Save action (${name})`,
            input: {
              name,
              action_type,
              when_trigger,
              trigger_table,
              action_config,
            },
          },
        };
      },
    };
  };
}

module.exports = AnyActionSkill;
