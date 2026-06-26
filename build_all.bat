@echo off
set JAVA_HOME=C:\Users\Sergey\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2
set ANDROID_HOME=C:\Users\Sergey\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%PATH%
cd android
call gradlew.bat assembleRelease
call gradlew.bat bundleRelease
cd ..
copy android\app\build\outputs\apk\release\app-release.apk StreamLume_Fixed.apk
copy android\app\build\outputs\bundle\release\app-release.aab StreamLume_Fixed.aab
