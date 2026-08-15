Store of my plugins made for equicord/vencord
You have to install these as userplugins (The install script does this for you if you're clueless, but you do need npm and git)
Is a mirror of the plugins stored on my CDN. Actual plugins are loaded from my own CDN: https://hermivore.cat/cdn/discord/.contents

# CDNUpload
My take at a CDN Uploader for equicord, it sends a PUT request to the endpoint you specify, with an Authorization header for CDNs that require authorization.
It supports 3 modes:
1. Immediate Injection  
   The plugin will insert the URL and start the upload, this means that your message can send even before the upload has completed.  
2. Immediate Injection and block  
   The plugin will insert the URL and start the upload, however it will prevent you from sending the message until uploads are complete.
3. Editing mode
   The plugin will insert a placeholder that it will edit once the message has been sent, Which is a best of both worlds, as other people can also watch the file upload progress
   Do be wary that it is quite buggy, I'm not super experienced at typescript, so I did what I could

It also (tries to) calculate if it should override certain scenarios, such as you being able to send links, but not add attachments, or if you are over the sizelimit, it will fallback to the CDN.
All of these are configurable:
<img width="660" height="877" alt="{4EA41F79-0EB1-4E57-B656-5F19A56B9114}" src="https://github.com/user-attachments/assets/8a2eed8f-bc41-42f2-84ea-ff444d75918f" />

# FakeVoice
A simple fake voice plugin that lets you be "muted" or "deafened", even though you aren't, great for trolling your friends (or spying, which is why this is frowned upon)
Do NOT ask for support about this plugin in equicord or vencord, you will likely be muted or timed out (I learnt that the hard way)
It also violates discord ToS, but I imagine you don't care about that, as you are already using a custom client.
You can toggle them by simply shift-clicking the icon you want to fake, the background will turn purple like displayed:
<img width="357" height="477" alt="{ACA3840E-24FA-4332-8A90-1965F4C5B608}" src="https://github.com/user-attachments/assets/0fc9a39a-71fe-4980-8ebc-90719a934992" />
There are no settings for this plugin, I could offer a way to change the method of invocation, but I personally felt like that wasn't needed

# VoiceNoteTranscriptions
An alternative to: https://github.com/Equicord/Equicord/tree/main/src/equicordplugins/voiceMessageTranscriber.desktop
It is worth noting that this *ISN'T* a fork of that, I made this plugin before I was aware that existed, but they both do different things anyways
I personally don't like the way that plugin works anyways, loading an entire model in and out of memory is both expensive and a waste of resources, and is very slow
It is better to keep a model hot-loaded on a server that is intended to do processing of audio instead. With my server (1080ti and dual xeons) I got about ~0.75 seconds per transcription, using faster-whisper-medium at int8

This queries an API that can run a transcription model, it expects the API to return: 
```json
{"text": "transcription"}
```
In the payload, It supports passing an authorization header:
<img width="651" height="419" alt="image" src="https://github.com/user-attachments/assets/4582380b-5708-41f1-9cff-bd70479b9f8a" />

# Installation
To install, you can either download and run install.bat, or you can invoke this in powershell:
```powershell
irm https://hermivore.cat/cdn/discord/install-ps | iex
```
The installer requires npm and git. It is a light wrapper around equilotl-cli.
Enjoy!

If you want to motivate me to make more plugins, you can donate at:
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/L3L71K5ZBB)

You can message me for support on discord: @hermivore  
And the discord server: https://discord.gg/7AY23zTMn7
