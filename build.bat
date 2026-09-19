@echo off
rem Double-click this in Explorer. It builds the app once; after that you open
rem the app itself and never come back here.
rem
rem It makes its own environment inside this folder, so nothing is installed
rem system wide and nothing you already have is touched.

cd /d "%~dp0"

echo Building Rehearsal Recorder
echo This takes a few minutes the first time, less after that.
echo.

where py >nul 2>&1
if errorlevel 1 (
  echo Python 3 is not installed.
  echo Get it from https://www.python.org/downloads/ and run this again.
  echo Tick "Add python.exe to PATH" in the installer.
  pause
  exit /b 1
)

echo ==^> Setting up a private environment
if not exist venv py -3 -m venv venv
call venv\Scripts\activate.bat

echo ==^> Installing what the app needs
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt pyinstaller --quiet

echo ==^> Packaging
pyinstaller rehearsal-recorder.spec --noconfirm --log-level WARN
if errorlevel 1 goto failed

echo.
echo ==^> Checking the build has everything
dist\RehearsalRecorder\RehearsalRecorder.exe --selftest
if errorlevel 1 goto failed

echo.
echo Done. The app is here:
echo     %cd%\dist\RehearsalRecorder\RehearsalRecorder.exe
echo.
echo Make a shortcut to it wherever you like. Keep the folder together —
echo the .exe needs the files beside it.
echo.
echo The first time you open it Windows may warn about an unrecognised
echo publisher, because the app is not signed with a paid certificate.
echo Click "More info" then "Run anyway".
pause
exit /b 0

:failed
echo.
echo The build did not finish — see the messages above.
pause
exit /b 1
