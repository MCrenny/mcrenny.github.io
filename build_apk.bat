@echo off
set JAVA_HOME=C:\Users\Sergey\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2
set ANDROID_HOME=C:\Users\Sergey\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%PATH%
echo JAVA_HOME=%JAVA_HOME%
java -version
cd android
call gradlew.bat assembleRelease
