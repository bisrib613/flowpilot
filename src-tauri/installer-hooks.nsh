!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Normal uninstall (including /P) preserves all profiles, cookies and
  ; browser sessions. Tauri's own "Delete application data" checkbox is the
  ; ONLY way to request deletion, and it needs a second explicit confirmation.
  ; In-place upgrades never call the uninstaller.
  ${If} $UpdateMode <> 1
  ${AndIf} $DeleteAppDataCheckboxState = 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "PERMANENT DATA DELETION: This will remove ALL Flowpilot accounts, Google Flow sessions, Claude/ChatGPT logins and local settings. This cannot be undone. Delete all application data?" IDYES flowpilot_delete_data_confirmed
    StrCpy $DeleteAppDataCheckboxState 0
    flowpilot_delete_data_confirmed:
  ${EndIf}
!macroend
