const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")

const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"))
const nsis = config.bundle.windows.nsis
const template = fs.readFileSync("src-tauri/" + nsis.template, "utf8")
const hooks = fs.readFileSync("src-tauri/" + nsis.installerHooks, "utf8")

test("Flowpilot uses its non-destructive NSIS template in all Windows builds", () => {
  assert.equal(nsis.template, "windows/flowpilot-installer.nsi")
  assert.match(template, /Page custom FlowpilotCheckUpgrade/)
  assert.match(template, /nsis_tauri_utils::SemverCompare/)
  assert.match(template, /\$R0 = -1[\s\S]*?Quit/)
  assert.match(template, /\$R0 = 0\s*\$\{OrIf\} \$R0 = 1[\s\S]*?Abort/)
  assert.doesNotMatch(template, /Page custom PageReinstall|Function PageLeaveReinstall/)
  assert.doesNotMatch(template, /\$\(uninstallBeforeInstalling\)|Goto reinst_uninstall/)
})

test("running setup never executes a previous installation's uninstaller", () => {
  const begin = template.indexOf("Function FlowpilotCheckUpgrade")
  const gate = template.slice(begin, template.indexOf("FunctionEnd", begin))
  // WebView2's normal dependency installer also uses ExecWait. The security
  // invariant is specific to the upgrade gate: it must never run ANY
  // previous-uninstaller command or expose an uninstall selection.
  assert.ok(begin >= 0)
  assert.doesNotMatch(gate, /ExecWait|Goto reinst_uninstall|Uninstall before installing/)
  assert.match(gate, /Unable to compare Flowpilot versions safely/)
  assert.match(gate, /Downgrading is blocked/)
  assert.match(gate, /An older MSI installation/)
})

test("app session data can only be deleted after explicit uninstall checkbox and confirmation", () => {
  const previous = hooks.slice(hooks.indexOf("!macro NSIS_HOOK_PREUNINSTALL"))
  assert.doesNotMatch(previous, /RMDir|RmDir|Delete\s+"?\$LOCALAPPDATA/i)
  assert.match(previous, /\$DeleteAppDataCheckboxState = 1/)
  assert.match(previous, /MB_DEFBUTTON2/)
  assert.match(previous, /StrCpy \$DeleteAppDataCheckboxState 0/)
  // Upstream uninstaller must still respect the Tauri user-controlled checkbox.
  assert.match(template, /\$DeleteAppDataCheckboxState = 1/)
  assert.match(template, /\$UpdateMode <> 1/)
})

test("first install and in-place upgrades keep Tauri normal install operations", () => {
  assert.match(template, /Function RestorePreviousInstallLocation/)
  assert.match(template, /!insertmacro CheckIfAppIsRunning/)
  assert.match(template, /WriteUninstaller/)
  assert.match(template, /Function un\.onInit/)
  assert.match(template, /Section Uninstall/)
})
