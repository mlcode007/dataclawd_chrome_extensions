@echo off
chcp 65001 >nul
set CHROME_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE_NAME=temp1
set USER_DATA=c:/chrome-spider/%PROFILE_NAME%
set URL=https://www.rednote.com/explore

:loop
echo [%date% %time%] 启动 Chrome（国内 IP 会从 rednote.com 跳转到 xiaohongshu.com，故打开两次）...
start "" %CHROME_EXE% --user-data-dir="%USER_DATA%" --new-tab %URL%
echo 等待 5 秒后再次打开同一 URL...
timeout /t 5 /nobreak
start "" %CHROME_EXE% --user-data-dir="%USER_DATA%" --new-tab %URL%

echo 等待 1800 秒...
timeout /t 1800 /nobreak

echo [%date% %time%] 关闭当前实例 Chrome（仅 user-data-dir 含 %PROFILE_NAME% 的进程）...
powershell -NoProfile -Command "$p='%PROFILE_NAME%'; Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Where-Object { $_.CommandLine -like \"*$p*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo 等待 2 秒后重新打开...
timeout /t 2 /nobreak

goto loop
