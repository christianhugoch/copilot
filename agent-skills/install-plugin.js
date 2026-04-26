const InstallPluginAction = require("../actions/install-plugin-action");
const Plugin = require("@saltcorn/data/models/plugin");

class InstallPluginSkill {
  static skill_name = "Install Plugin";

  get skill_label() {
    return "Install Plugin";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return (
      `Use list_plugins to browse available Saltcorn store plugins before installing. ` +
      `Use install_plugin to install a plugin. Prefer store plugins (plugin_name) over npm packages. ` +
      `Do not install a plugin that is already installed.`
    );
  }

  get userActions() {
    return {
      async install_copilot_plugin(input, req) {
        const result = await InstallPluginAction.execute(input, req);
        return {
          notify: result.postExec || "Plugin installation complete.",
        };
      },
    };
  }

  provideTools = () => {
    return [
      {
        type: "function",
        process: async ({ category }) => {
          try {
            const plugins = await Plugin.store_plugins_available();
            const filtered =
              category === "theme"
                ? plugins.filter((p) => p.has_theme)
                : category === "auth"
                  ? plugins.filter((p) => p.has_auth)
                  : plugins;
            if (!filtered.length) return "No plugins found.";
            return filtered
              .map(
                (p) => `${p.name}${p.description ? `: ${p.description}` : ""}`,
              )
              .join("\n");
          } catch (e) {
            return `Error listing plugins: ${e.message}`;
          }
        },
        function: {
          name: "list_plugins",
          description:
            "List available plugins from the Saltcorn store. Call this before installing to find the right plugin name.",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["theme", "auth", "all"],
                description:
                  "Filter plugins: 'theme' for UI themes, 'auth' for authentication plugins, 'all' for everything",
              },
            },
            required: ["category"],
          },
        },
      },
      {
        type: "function",
        process: async (input) => {
          const label = input.plugin_name || input.npm_package;
          if (!label) return "Please provide a plugin name or npm package.";
          return `Installing plugin: ${label}...`;
        },
        postProcess: async ({ tool_call, req }) => {
          const input = tool_call.input || {};
          if (this.yoloMode) {
            const result = await InstallPluginAction.execute(input, req);
            return {
              stop: true,
              add_response: result.postExec || "Plugin installation complete.",
            };
          }
          return {
            stop: true,
            add_user_action: {
              name: "install_copilot_plugin",
              type: "button",
              label: `Install plugin ${input.plugin_name || input.npm_package}`,
              input,
            },
          };
        },
        function: {
          name: InstallPluginAction.function_name,
          description: InstallPluginAction.description,
          parameters: InstallPluginAction.json_schema(),
        },
      },
    ];
  };
}

module.exports = InstallPluginSkill;
