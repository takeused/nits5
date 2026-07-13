' ================================================================
' 백그라운드시작.vbs
' 역할: cmd 창 없이 프록시 서버를 조용히 실행 + 브라우저 오픈
' 사용: 더블클릭 또는 시작프로그램에 등록
' ================================================================

Dim fso, shell, scriptDir

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' 이 스크립트가 있는 폴더 기준으로 경로 설정
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' ── 포트 3737 사용 여부 확인 ──────────────────────────────
Dim cmd, result
cmd    = "cmd /c netstat -an 2>nul | find "":3737 "" | find ""LISTENING"""
result = shell.Run(cmd, 0, True)  ' 0=숨김, True=완료 대기

If result = 0 Then
    ' 이미 실행 중 → 브라우저만 오픈
    shell.Run "http://127.0.0.1:3737", 1, False
    WScript.Quit 0
End If

' ── node.js 실행 ────────────────────────────────────────
Dim nodePath
nodePath = "node"   ' PATH에 node 있으면 그냥 "node", 없으면 전체 경로 입력

Dim runCmd
runCmd = nodePath & " """ & scriptDir & "\proxy-server.js"""

' 0 = 완전 숨김 창, False = 완료를 기다리지 않고 바로 다음으로
shell.Run runCmd, 0, False

' ── 서버 준비 대기 (최대 10초) ──────────────────────────
Dim i
For i = 1 To 10
    WScript.Sleep 1000
    result = shell.Run(cmd, 0, True)
    If result = 0 Then Exit For
Next

' ── 브라우저 오픈 ────────────────────────────────────────
shell.Run "http://127.0.0.1:3737", 1, False

Set fso   = Nothing
Set shell = Nothing
