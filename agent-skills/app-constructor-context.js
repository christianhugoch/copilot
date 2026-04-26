const user_registration_hints = `User registration notes:
* The "users" table is built-in. Passwords are platform-managed — never add a password field to a view.
* Signup uses a built-in form, not an Edit view.
* For verification/confirmation emails after registration, create a Trigger with event "Insert" on "users".
  The trigger must use a Workflow action with a single step of type "run_js_code". Do NOT use the send_email action — it will not work for verification. The run_js_code step must contain exactly:
  const { send_verification_email } = require("@saltcorn/data/models/email");
  await send_verification_email(row, req);`;

class AppConstructorContextSkill {
  static skill_name = "AppConstructor Context";

  get skill_label() {
    return "AppConstructor Context";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return user_registration_hints;
  }
}

module.exports = AppConstructorContextSkill;
