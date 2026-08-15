# powershell -Command "Invoke-WebRequest -Uri 'https://hermivore.cat/cdn/discord/install' -OutFile '%TEMP%\downloaded.bat' -UseBasicParsing" && "%TEMP%\downloaded.bat"
# ^ cmd one liner
# so that means you can do: 
# irm https://hermivore.cat/cdn/discord/install-ps | iex
# for those of you that are really that lazy (cough cough quuut)
$b = "$env:TEMP\hermivore.bat"
Invoke-WebRequest -Uri 'https://hermivore.cat/cdn/discord/install' -OutFile $b -UseBasicParsing
cmd /c "`"$b`""
