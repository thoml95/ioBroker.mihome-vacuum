![Logo](admin/mihome-vacuum.png)
ioBroker mihome-vacuum adapter
=================
[![NPM version](http://img.shields.io/npm/v/iobroker.mihome-vacuum.svg)](https://www.npmjs.com/package/iobroker.mihome-vacuum)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mihome-vacuum.svg)](https://www.npmjs.com/package/iobroker.mihome-vacuum)
[![Tests](https://travis-ci.org/ioBroker/ioBroker.mihome-vacuum.svg?branch=master)](https://travis-ci.org/ioBroker/ioBroker.mihome-vacuum)

[![NPM](https://nodei.co/npm/iobroker.mihome-vacuum.png?downloads=true)](https://nodei.co/npm/iobroker.mihome-vacuum/)

This adapter allows you control the Xiaomi vacuum cleaner.

### Description
See here https://github.com/jghaanstra/com.robot.xiaomi-mi

The control commands are 80 bytes long.

### Install

```
cd /opt/iobroker
npm install iobroker.mihome-vacuum
iobroker add mihome-vacuum
```

## Konfiguration
Derzeit stellt das Ermitteln des Tokens das größte Problem.
Token Vorgehen:

#### 1. Um den Token des Roboters zu bekommen, muss man ihn erstmal aus dem Wlan abmelden.
Dies geht entweder über die app unter den Einstellungen des Gerätes 
(genauer kann ich es nicht beschreiben weil ich kein Chinesisch kann). 
Da steht Remove Device, über diesen Punkt kann man das Gerät Entfernen
Alternativ kann man auch den Resetknopf am Gerät drücken.
#### 2. Nun verbindet man sich mit seinem Windows (pder anderer Betriebssystem) Rechner mit dem Wlan des Roboters. Der Rechner muss also WLAN haben
Die Kennung des Wlan lautet: rockrobo...
#### 3. Programm Packet Sender
Das Programm "Packet Sender" muss installiert sein und gestartet werden
Bei HEX gibt man die folgende Nachricht ein:
21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff
(=HALO Nachricht)
#### 4. IP Vacuum 192.168.8.1, Port 54321, Nachrichtentyp UDP
#### 5. Packet senden.
Fenster unten: a) gesetzte Nachricht
b) darüber die Antwort von dem Roboter
#### 6. die letzten 16 Byte der Token

## Widget
![Widget](widgets/img/previewControl.png)

## Changelog

### 0.0.1 (2017-01-16)
* (bluefox) initial commit
