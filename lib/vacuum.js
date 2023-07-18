'use strict';
// const utils = require('@iobroker/adapter-core');
// const {hostname} = require('os');
let adapter = null;
// const miio = null;
const objects = require('./objects');
const TimerManager = require('./timerManager.js');
const RoomManager = require('./roomManager');
// const MapHelper = require('./maphelper');
const commands = require('./stockCommands');

global.systemDictionary = {};
// @ts-ignore
require('../admin/words.js');

// const lastProps = {};

// const userLang = 'en';
// this parts will be translated
const i18n = {
	weekDaysFull: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	notAvailable: 'not available',
	nextTimer: 'next timer',
	loadRooms: 'load rooms from robot',
	cleanRoom: 'clean Room',
	cleanMultiRooms: 'clean assigned rooms',
	addRoom: 'insert map Index or zone coordinates',
	waterBox_installed: 'water box installed',
	waterBox_filter: 'clean water Filter',
	waterBox_filter_reset: 'water filter reset',
	waitingPos: 'waiting position'
};

const errorTexts = {
	'0': 'No error',
	'1': 'Laser distance sensor error',
	'2': 'Collision sensor error',
	'3': 'Wheels on top of void, move robot',
	'4': 'Clean hovering sensors, move robot',
	'5': 'Clean main brush',
	'6': 'Clean side brush',
	'7': 'Main wheel stuck?',
	'8': 'Device stuck, clean area',
	'9': 'Dust collector missing',
	'10': 'Clean filter',
	'11': 'Stuck in magnetic barrier',
	'12': 'Low battery',
	'13': 'Charging fault',
	'14': 'Battery fault',
	'15': 'Wall sensors dirty, wipe them',
	'16': 'Place me on flat surface',
	'17': 'Side brushes problem, reboot me',
	'18': 'Suction fan problem',
	'19': 'Unpowered charging station',
};

const cleanStates = {
	Unknown: 0,
	Initiating: 1,
	Sleeping: 2,
	Waiting: 3,
	Remote: 4,
	Cleaning: 5,
	Back_toHome: 6,
	ManuellMode: 7,
	Charging: 8,
	Charging_Error: 9,
	Pause: 10,
	SpotCleaning: 11,
	InError: 12,
	ShuttingDown: 13,
	Updating: 14,
	Docking: 15,
	GoingToSpot: 16,
	ZoneCleaning: 17,
	RoomCleaning: 18,
	DustCollecting: 22,
	CleaningMop: 23,
	GoingMopClean: 26
};

const activeCleanStates = {
	5: {
		name: 'all ',
		resume: 'app_start'
	},
	11: {
		name: 'spot ',
		resume: 'app_spot'
	},
	17: {
		name: 'zone ',
		resume: 'resume_zoned_clean'
	},
	18: {
		name: 'segment ',
		resume: 'resume_segment_clean'
	},
	22: {
		name: 'dust collecting '
	},
	23: {
		name: 'clean mop '
	},
	26: {
		name: 'going to mop clean '
	}
};
const clean = null;

let enable_carpet_mode = {
	enabled: 1,
	stall_time: 10,
	low: 400,
	high: 500,
	integral: 450
};

const Vacuum = {}; // empty device

Vacuum.features = {
	'model': null,
	'zoneClean': false,
	'mop_mode': null,
	'water_box': null,
	'water_filter': null,
	'water_box_mode': null,
	'dustCollect': null,
	/** @type {boolean | null} */
	'carpetMode': null,
	/** @type {boolean | null} */
	'roomMapping': null,
	'NewSuctionPower': null,
	'mop': null
};
Vacuum.lastGoto = [];
Vacuum.lastZone = [
	[]
];

class VacuumManager {
	constructor(adapterInstance, Miio, miApi) {
		this.Miio = Miio;
		this.miApi = miApi;
		this.device = adapterInstance.device;
		Vacuum.modell = adapterInstance.device;
		adapter = adapterInstance;
		this.globalTimeouts = {};
		this.logEntries = [];
		this.Error = false;

		// remember last Map State
		this.lastMapState = null;

		// values for Roboter StatusControl
		this.cleandState = cleanStates.Unknown; // current robot Status
		this.cleanActiveState = 0; // if robot is working, than here the status is saved
		// this.checkCleanState = null;
		this.activeChannels = null;
		this.queue = []; // if new job is called, while robot is already cleaning

		// values for Map
		// this.mapRetries = 0;
		this.mapPointer = '';
		this.mapLastSave = Date.now();
		this.mapGet = false;
		this.mapEnable = adapter.config.enableMiMap || adapter.config.valetudo_enable;
		// MAP initial
		this.cMapPoll = 900000; // 15 Min
		this.cMapLastPoll = 0;
		this.mapSaveIntervall = parseInt(adapter.config.valetudo_MapsaveIntervall, 10) || 5000;
		this.mapPollIntervall = parseInt(adapter.config.valetudo_requestIntervall, 10) || 2000;
		this.mapReady = {
			login: false,
			mappointer: false
		};


		adapter.getState('info.device_fw', (err, state) => {
			if (state && state.val) {
				Vacuum.firmware = state.val;
			}
		});

		this.startUp = {
			getMultiMapsList: this.getMultiMapsList,
			setGetCleanSummary: this.setGetCleanSummary,
			setGetConsumable: this.setGetConsumable
		};

		adapter.log.info('select standard vacuum protocol....');
		this.features = new FeatureManager();
		this.roomManager = new RoomManager(adapter, i18n);
		this.timerManager = new TimerManager(adapter, i18n);

		this.main();
	}

	async main() {
		await this.initStates();
		await this.init();
		this.getStates();
	}

	async init() {
		//übersetzte Begriffe
		// adapter.log.debug(JSON.stringify(adapter.systemDictionary));
		// adapter.getForeignObjectAsync('system.config').then( systemConfig => {
		//     if (systemConfig && systemConfig.common && systemConfig.common.language && systemDictionary.Sunday[systemConfig.common.language]) {
		//         userLang = systemConfig.common.language;
		//         let obj;
		//         for (const i in i18n) {
		//             obj = i18n[i];
		//             if (typeof obj == 'string') {
		//                 i18n[i] = systemDictionary[obj][userLang];
		//             } else if (typeof obj == 'object') {
		//                 for (const o in obj) {
		//                     obj[o] = systemDictionary[obj[o]][userLang];
		//                 }
		//             }
		//         }
		//     }
		// });

		if (adapter.config.enableMiMap) {
			await this.miApi.login()
				.then(answer => {
					//reqParams.push('get_map_v1'); todo: is this necessary, or it is enough with mapPoll?
					this.mapReady.login = true;
				})
				.catch(error => adapter.log.warn(error));
		} else if (adapter.config.valetudo_enable) {
			//this._MapPoll();
		}

		await Promise.all(objects.stockControl.map(async o => {
			const contents = await adapter.setObjectNotExistsAsync('control' + (o._id ? '.' + o._id : ''), o);
			contents && adapter.log.debug('Create State for control: ' + JSON.stringify(contents));
		}));
		await Promise.all(objects.stockInfo.map(async o => {
			const contents = await adapter.setObjectNotExistsAsync('info' + (o._id ? '.' + o._id : ''), o);
			contents && adapter.log.debug('Create State for stockInfo: ' + JSON.stringify(contents));
		}));
		await Promise.all(objects.stockConsumable.map(async o => {
			const contents = await adapter.setObjectNotExistsAsync('consumable' + (o._id ? '.' + o._id : ''), o);
			contents && adapter.log.debug('Create State for stockConsumable: ' + JSON.stringify(contents));
		}));
		await Promise.all(objects.stockHistory.map(async o => {
			const contents = await adapter.setObjectNotExistsAsync('history' + (o._id ? '.' + o._id : ''), o);
			contents && adapter.log.debug('Create State for stockHistory: ' + JSON.stringify(contents));
		}));
		await Promise.all(objects.roomStates.map(async o => {
			await adapter.setObjectNotExistsAsync('info' + (o._id ? '.' + o._id : ''), o);
			adapter.log.debug('Create State for Queue: ' + o._id);
		}));

		// check if resume Zoneclean is enabled
		!adapter.config.enableResumeZone && await Promise.all(objects.enableResumeZone.map(async o => {
			const contents = await adapter.setObjectNotExistsAsync('control' + (o._id ? '.' + o._id : ''), o);
			contents && adapter.log.debug('Create State for enableResumeZone: ' + JSON.stringify(contents));
		}));

		//chek if map is enabled -> therefore, that this datapoints also need for multifloor, we have to add them always
		//if (adapter.config.enableMiMap || adapter.config.valetudo_enable) {
		//adapter.log.info('create states for map');
		await Promise.all(objects.mapObjects.map(async o => {
			await adapter.setObjectNotExistsAsync('cleanmap' + (o._id ? '.' + o._id : ''), o);
			adapter.log.debug('Create State for map: ' + o._id);
		}));
		/*} else {
			adapter.log.info('Map not selected delete states...');
			objects.mapObjects.map(async o => await this.delObj('map' + (o._id ? '.' + o.id : '')));
		}*/

		adapter.config.enableResumeZone && objects.enableResumeZone.map(async o => await this.delObj('control' + (o._id ? '.' + o.id : '')));

		adapter.log.debug('Create State done!');
	}

	async delObj(id) {
		try {
			await adapter.delObjectAsync(id);
		} catch (error) {
			//... do nothing
		}
	}

	async getStates() {
		clearTimeout(this.globalTimeouts['getStates']);
		// let DeviceData;
		const NoError = false;

		adapter.log.debug('get params for stock Vacuum');
		try {
			// DeviceData = await this.Miio.sendMessage('get_map_v1');
			await this.setGetStatus();
			await this.getSetNetwork();
			await this.setGetSoundVolume();
			// await this.setGetConsumable();
			// await this.setGetCleanSummary();
			// await this.getMultiMapsList();
			// NoError = true;
			await this.getOnlyAtStart();

			if (Date.now() - this.cMapLastPoll > this.cMapPoll && !this.mapGet) {
				await this.getMapPointer();
			}

			this.timerManager && this.timerManager.check();
			// Promise.all([statusObj, soundObj, consumableObj, cleaningObj]).catch(function (err) {
			// 	adapter.log.error(err);
			// });
		} catch (error) {
			adapter.log.warn('ERROR' + error);
		}

		//carpetMode first run to create States need no Error to detect if Messages receive before
		if (!this.Error && Vacuum.features.carpetMode === null) {
			await this.checkFeaturesCarpet();
		}
		Vacuum.features.carpetMode && await this.setGetCarpetMode();

		//Room Mapping first run to create States need no Error to detect if Messages receive before
		if (!this.Error && this.features.roomMapping === null) {
			await this.checkFeaturesRoomMapping();
		}

		this.globalTimeouts['getStates'] = setTimeout(this.getStates.bind(this), adapter.config.pingInterval);
	}
	async getOnlyAtStart() {
		for (const __fkt in this.startUp) {
			const isTrue = await this[__fkt]();
			adapter.log.debug(`Startup: ${__fkt} Answer: ${isTrue}`);

			if (isTrue) {
				delete this.startUp[__fkt];
				adapter.log.debug('Startup: Delete ' + __fkt);
			}
		}
	}

	async getSetNetwork() {
		try {
			const answer = await this.Miio.sendMessage('get_network_info');
			if (answer.result && answer.result !== 'unknown_method' && answer.result.rssi) {
				await adapter.setStateAsync('deviceInfo.wifi_signal', {
					val: answer.result.rssi,
					ack: true
				});
			}
		} catch (error) {
			adapter.log.debug('Error at getSetNetwork: ' + error);
		}
	}

	async getMultiMapsList() {
		//get_multi_maps_list
		try {
			const answer = await this.Miio.sendMessage('get_multi_maps_list');
			if (answer.result && answer.result !== 'unknown_method') {
				const maps = answer.result[0].map_info;
				adapter.log.debug('States for ' + maps.length + ' Map: ' + JSON.stringify(maps));
				if (maps.length > 0) {
					const stateArray = {};
					maps.forEach(__map => {
						stateArray[__map.mapFlag] = (__map.name !== '' ? __map.name : '' + __map.mapFlag);
					});
					adapter.log.debug('States for Map: ' + JSON.stringify(stateArray));
					adapter.extendObjectAsync('cleanmap.actualMap', {
						common: {
							states: stateArray
						}
					});
					return true;
				}
				return true;
			}
			return true;
		} catch (error) {
			return false;
		}
	}

	async checkFeaturesRoomMapping() {
		try {
			const answer = await this.Miio.sendMessage('get_room_mapping');
			if (answer.result && answer.result !== 'unknown_method' && answer.result.length) {
				this.features.roomMapping = true;

				Vacuum.rooms = [answer.result];
				Vacuum.features.roomMapping = true;

				this.roomManager.processRoomMaping(answer);

				// check again in 15 min
				this.globalTimeouts['getRoomMap'] = setTimeout(this.checkFeaturesRoomMapping.bind(this), 900000);

			} else {

				this.features.roomMapping = false;
				Vacuum.features.roomMapping = false;
				if (typeof (Vacuum.rooms) === 'undefined') Vacuum.features.roomMapping = false;
			}
		} catch (error) {

			this.features.roomMapping = false;
			this.globalTimeouts['getRoomMap'] = setTimeout(this.checkFeaturesRoomMapping.bind(this), 900000);
		}
	}
	async getMapPointer() {
		const trys = 0;
		clearTimeout(this.globalTimeouts['getMapData']);

		//valetudo dont need a mappointer so go on
		if (adapter.config.valetudo_enable) {
			this.getMapData();
			return;
		}

		try {
			for (let index = 0; index < 5; index++) {
				let answer = await this.Miio.sendMessage('get_map_v1');
				if (answer.result){
					answer = answer.result[0];
					adapter.log.warn('getMapPointer' + answer);
					if (answer.split('%').length === 1) {
						if (answer.startsWith('map_slot')) {
							return;
						}
					} else if (answer.split('%').length === 3) {
						this.mapPointer = answer;
						adapter.log.debug('Mappointer_updated');
						this.mapReady.mappointer = true;
						await this.getMapData();
						return;
					}
				}
				// robo need some time to generate mappointer if he wants a "retry"
				await this.delay(300);

			}
			// received no Mappointer, try again in ...
			if (this.mapGet) {
				this.globalTimeouts['getMapData'] = setTimeout(async () => {
					adapter.log.debug('Get Mappointer while cleaning');
					this.mapEnable && this.getMapPointer(); // get pointer only by mimap
				}, this.mapPollIntervall);
			}
			return;

		} catch (error) {
			if (this.mapGet) {
				this.globalTimeouts['getMapData'] = setTimeout(async () => {
					adapter.log.debug('Get Mappointer while cleaning');
					this.mapEnable && this.getMapPointer(); // get pointer only by mimap
				}, this.mapPollIntervall);
			}
		}
	}

	async delay(time) {
		return new Promise(resolve =>
			this.globalTimeouts['delay'] = setTimeout(resolve, time));
	}

	async getMapData() {
		if ((!this.mapReady.mappointer || !this.mapReady.login) && adapter.config.enableMiMap) {
			return;
		}
		this.miApi.updateMap(this.mapPointer)
			.then(async data => {
				if (data) {
					// get rooms from Map only needed for S5
					const rooms = data[1];
					if ((Vacuum.modell === 'roborock.vacuum.s5' || Vacuum.modell === 'roborock.vacuum.s5e') && Vacuum.features.roomMapping === false && typeof rooms !== 'undefined' && rooms.length > 0) {
						const roomids = [];
						rooms.forEach(element =>
							roomids.push([element, 'room' + element]));

						adapter.log.info('Room array empty... generate from mapdata.. ' + JSON.stringify(roomids));
						Vacuum.features.roomMapping = true;
						Vacuum.rooms = roomids;
						this.roomManager.processRoomMaping({
							id: 'dummy',
							result: roomids
						});
					}
					// get zone cleaning coordinates
					const zones = data[2];

					if (typeof zones !== 'undefined' && zones.length > 0 && (zones[0][0] !== Vacuum.lastZone[0][0])) {
						adapter.log.debug('zone changed' + JSON.stringify(zones));
						Vacuum.lastZone = zones;

						//parse to normal format
						const newArray = [];
						zones.forEach(zone => {
							zone.push(1);
							newArray.push(zone);
						});
						let string = JSON.stringify(newArray);
						string = string.substring(1, string.length - 1);

						await adapter.setForeignStateAsync(adapter.namespace + '.control.zoneClean', {
							val: string,
							ack: true
						});
					}

					// get Point  coordinates
					const goto = data[3];
					if (typeof goto !== 'undefined' && goto.length > 0 && goto[0] !== Vacuum.lastGoto[0]) {
						adapter.log.debug('goto changed' + JSON.stringify(goto));
						Vacuum.lastGoto = goto;
						await adapter.setForeignStateAsync(adapter.namespace + '.control.goTo', {
							val: goto.join(),
							ack: true
						});
					}

					const dataurl = data[0].toDataURL();
					await adapter.setForeignStateAsync(adapter.namespace + '.cleanmap.map64', {
						val: dataurl,
						ack: true
					});

					if (Date.now() - this.mapLastSave > this.mapSaveIntervall) {
						const buf = data[0].toBuffer();
						adapter.writeFile('mihome-vacuum.admin', `actualMap_${adapter.instance}.png`, buf, error => {
							if (error) {
								adapter.log.error('Error by saving of the map');
							} else {
								adapter.setState('cleanmap.mapURL', `/mihome-vacuum.admin/actualMap_${adapter.instance}.png`, true);
							}
							this.mapLastSave = Date.now();
						});
					}
					this.cMapLastPoll = Date.now();
				}
				if (this.mapGet) {
					//adapter.log.info(VALETUDO.POLLMAPINTERVALL)
					this.globalTimeouts['getMapData'] = setTimeout(async () => {
						adapter.log.debug('Get Mappointer while cleaning');
						this.mapEnable && this.getMapPointer(); // get pointer only by mimap

						//this.getMapData();
					}, this.mapPollIntervall);
				}
			})
			.catch(err => {
				adapter.log.debug(err);
				if (this.mapGet) {
					this.globalTimeouts['getMapData'] = setTimeout(async () => {
						this.mapEnable && this.getMapPointer(); // get pointer only by mimap
						//	this.getMapData();
					}, this.mapPollIntervall);
				}
			});
	}

	async checkFeaturesCarpet() {
		try {
			const answer = await this.Miio.sendMessage('get_carpet_mode');
			if (answer.result && answer.result !== 'unknown_method') {
				if (Vacuum.features.carpetMode === null) {
					Vacuum.features.carpetMode = true;
					adapter.log.info('create state for carpet_mode');
					adapter.setObjectNotExists('control.carpet_mode', objects.carpet_mode);
				}
			} else {
				Vacuum.features.carpetMode = false;
			}
		} catch (error) {
			Vacuum.features.carpetMode = false;
		}
	}

	async setGetCarpetMode() {
		try {
			const answer = await this.Miio.sendMessage('get_carpet_mode');
			if (answer.result && (answer.result[0].enable === 0 || answer.result[0].enable === 1)) {
				await adapter.setStateAsync('control.carpet_mode', {
					val: answer.result[0].enable === 1,
					ack: true
				});
				if (answer.result[0].enable === 1) {
					enable_carpet_mode = answer.result[0];
				}
			}
		} catch (error) {

		}
	}
	async setGetCleanSummary() {
		try {
			const answer = await this.Miio.sendMessage('get_clean_summary');
			if (!answer.result)
				return false;
			const summary = await this.parseCleaningSummary(answer);

			adapter.setStateAsync('history.total_time', {
				val: Math.round(summary.clean_time / 60),
				ack: true
			});
			adapter.setStateAsync('history.total_area', {
				val: Math.round(summary.total_area / 1000000),
				ack: true
			});
			adapter.setStateAsync('history.total_cleanups', {
				val: summary.num_cleanups,
				ack: true
			});

			if (!await this.isEquivalent(summary.cleaning_record_ids, this.logEntries)) {
				this.logEntries = summary.cleaning_record_ids;

				const cleanlogJson = await this.getLogEntries(this.logEntries);

				adapter.setStateAsync('history.allTableJSON', {
					val: JSON.stringify(cleanlogJson),
					ack: true
				});
				adapter.setStateAsync('history.allTableHTML', {
					val: await this.createHtmlTable(cleanlogJson),
					ack: true
				});
				return true;
			}
			return true;
		} catch (error) {
			adapter.log.debug('ERROR at setGetCleanSummary: ' + error);
			return false;
		}
	}

	async parseCleaningSummary(response) {
		response = response.result;

		// {
		// 	"id": 9,
		// 	"result": {
		// 		"clean_time": 25075,
		// 		"clean_area": 376442500,
		// 		"clean_count": 10,
		// 		"dust_collection_count": 0,
		// 		"records": [1617553319, 1617470350, 1617380294, 1617374983, 1617370233, 1617356620, 1617209982, 1617201614, 1617165226, 1617121021]
		// 	},
		// 	"exe_time": 101
		// }
		// check if S7. Use different response
		if (response.clean_time) {
			return {
				clean_time: response.clean_time, // in seconds
				total_area: response.clean_area, // in cm^2
				num_cleanups: response.clean_count,
				cleaning_record_ids: response.records, // number[]
			};
		} else {
			return {
				clean_time: response[0], // in seconds
				total_area: response[1], // in cm^2
				num_cleanups: response[2],
				cleaning_record_ids: response[3], // number[]
			};
		}
	}

	async isEquivalent(a, b) {
		// Create arrays of property names
		const aProps = Object.getOwnPropertyNames(a);
		const bProps = Object.getOwnPropertyNames(b);

		// If number of properties is different,
		// objects are not equivalent
		if (aProps.length !== bProps.length) {
			return false;
		}

		for (let i = 0; i < aProps.length; i++) {
			const propName = aProps[i];

			// If values of same property are not equal,
			// objects are not equivalent
			if (a[propName] !== b[propName]) {
				return false;
			}
		}

		// If we made it this far, objects
		// are considered equivalent
		return true;
	}

	async getLogEntries(logArray) {
		if (!logArray || logArray.length === 0) {
			return;
		}
		const cleanJSON = [];

		try {
			const start = async () => {
				await this.asyncForEach(logArray, async (num) => {
					const response = await this.Miio.sendMessage('get_clean_record', [num]);
					const records = await this.parseCleaningRecords(response);

					records && records.forEach(record => {
						const dates = new Date();
						dates.setTime(record.start_time * 1000);

						cleanJSON.push({
							Datum: dates.getDate() + '.' + (dates.getMonth() + 1),
							Start: (dates.getHours() < 10 ? '0' : '') + dates.getHours() + ':' + (dates.getMinutes() < 10 ? '0' : '') + dates.getMinutes(),
							Saugzeit: Math.round(record.duration / 60) + ' min',
							'Fläche': Math.round(record.area / 10000) / 100 + ' m²',
							Error: record.errors,
							Ende: record.completed
						});
					});
				});
				adapter.log.debug('finish logs all ' + JSON.stringify(cleanJSON));
			};

			await start();
			return cleanJSON;
		} catch (error) {
			adapter.log.warn('Error at history: ' + error);
		}
	}

	async parseCleaningRecords(response) {
		// {"id":25,"result":[{"begin":1617121021,"end":1617135716,"duration":4217,"area":57002500,"error":0,"complete":0,"start_type":2,"clean_type":1,"finish_reason":37,"dust_collection_status":0}],"exe_time":100}
		// new Answer from S7
		return response && response.result ? response.result.map(entry => {
			if (entry.begin) {
				return {
					start_time: entry.begin, // unix timestamp
					end_time: entry.end, // unix timestamp
					duration: entry.duration, // in seconds
					area: entry.area, // in cm^2
					errors: entry.error, // ?
					completed: entry.complete === 1, // boolean
					start_type: entry.start_type, // ?? 1 = Roboter 2= app
					clean_type: entry.clean_type // ?? 1= fullClean 2=Zone 3 = roomclean
				};
			} else {
				return {
					start_time: entry[0], // unix timestamp
					end_time: entry[1], // unix timestamp
					duration: entry[2], // in seconds
					area: entry[3], // in cm^2
					errors: entry[4], // ?
					completed: entry[5] === 1, // boolean
					start_type: entry[6], // ?? 1 = Roboter 2= app
					clean_type: entry[7] // ?? 1= fullClean 2=Zone 3 = roomclean
				};
			}
		}) : null;
	}

	async createHtmlTable(cleanJSON) {
		// Tabelleneigenschaften
		// TODO: Translate
		const clean_log_html_attr = '<colgroup> <col width="50"> <col width="50"> <col width="80"> <col width="100"> <col width="50"> <col width="50"> </colgroup>';
		const clean_log_html_head = '<tr> <th>Datum</th> <th>Start</th> <th>Saugzeit</th> <th>Fläche</th> <th>???</th> <th>Ende</th></tr>';

		let lines = '';
		cleanJSON.forEach(line => {
			lines += `<tr><td>${line.Datum}</td><td>${line.Start}</td><td ALIGN="RIGHT">${line.Saugzeit}</td><td ALIGN="RIGHT">${line['Fläche']}</td><td ALIGN="CENTER">${line.Error}</td><td ALIGN="CENTER">${line.Ende}</td></tr>`;
		});
		return `<table>${clean_log_html_attr}${clean_log_html_head}${lines}</table>`;
	}

	async asyncForEach(array, callback) {
		for (let index = 0; index < array.length; index++) {
			await callback(array[index], index, array);
		}
	}

	async setGetSoundVolume() {
		try {
			const message = await this.Miio.sendMessage('get_sound_volume');
			this.Error = !message.result;
			if (!message.result)
				return;

			adapter.setStateAsync('control.sound_volume', {
				val: message.result[0],
				ack: true
			});
		} catch (error) {
			adapter.log.debug('ERROR at setGetSoundVolume: ' + error);
			this.Error = true;
		}
	}

	async setGetConsumable() {
		try {
			const message = await this.Miio.sendMessage('get_consumable');

			if (!message.result)
				return false;
			const consumable = message.result[0]; //parseConsumable(answer)
			this.Error = false;

			consumable.water_filter && await this.features.setWaterFilter(); // set for Waterfilter if exist

			adapter.setStateAsync('consumable.main_brush', {
				val: 100 - (Math.round(consumable.main_brush_work_time / 3600 / 3)), // 300h
				ack: true
			});
			adapter.setStateAsync('consumable.side_brush', {
				val: 100 - (Math.round(consumable.side_brush_work_time / 3600 / 2)), //200h
				ack: true
			});
			adapter.setStateAsync('consumable.filter', {
				val: 100 - (Math.round(consumable.filter_work_time / 3600 / 1.5)), // 150h
				ack: true
			});
			adapter.setStateAsync('consumable.sensors', {
				val: 100 - (Math.round(consumable.sensor_dirty_time / 3600 / 0.3)), //30h
				ack: true
			});

			this.features.water_filter && adapter.setStateAsync('consumable.water_filter', {
				val: 100 - (Math.round(consumable.filter_element_work_time / 3600)), // 100h
				ack: true
			});

			return true;
		} catch (error) {
			adapter.log.debug('ERROR at setGetConsumable: ' + error);
			this.Error = true;
			return false;
		}
	}

	async setGetStatus() {
		try {
			const answer= await this.Miio.sendMessage('get_status');

			this.Error = !answer.result;
			if (!answer.result)
				return;
			const status = await this.parseStatus(answer);
			adapter.log.debug('setGetStatus ' + JSON.stringify(status));		

			await this.features.setMop(status.mop_forbidden_enable);
			await this.features.setNewSuctionValues(Math.round(status.fan_power));
			await this.features.setWaterBox(status.water_box_status);
			await this.features.setWaterBoxMode(status.water_box_mode);
			await this.features.setMopMode(status.mop_mode);
			await this.features.setDockStatus(status.dock_error_status);
			await this.features.setDustCollect(status.dust_collection_status);


			adapter.setStateAsync('info.battery', {
				val: status.battery,
				ack: true
			});
			adapter.setStateAsync('info.state', {
				val: status.state,
				ack: true
			});
			adapter.setStateAsync('info.cleanedtime', {
				val: Math.round(status.clean_time / 60),
				ack: true
			});
			adapter.setStateAsync('info.cleanedarea', {
				val: Math.round(status.clean_area / 10000) / 100,
				ack: true
			});
			adapter.setStateAsync('control.fan_power', {
				val: Math.round(status.fan_power),
				ack: true
			});
			adapter.setStateAsync('info.error', {
				val: status.error_code,
				ack: true
			});
			adapter.setStateAsync('info.dnd', {
				val: status.dnd_enabled,
				ack: true
			});

			// map data
			if (status.map_status !== this.lastMapState) {
				//map has changed Set new States and run getmap and rooms

				this.lastMapState = status.map_status;
				await adapter.setStateAsync('cleanmap.actualMap', {
					val: !status.isLocating ? status.map_status >> 2 : -1,
					ack: true
				});
				await adapter.setStateAsync('cleanmap.mapStatus', {
					val: status.map_status % 4,
					ack: true
				});

				await this.getMapPointer();
				await this.checkFeaturesRoomMapping();
			}

			// features
			this.features.water_box && adapter.setStateAsync('info.water_box', {
				val: status.water_box_status === 1,
				ack: true
			});
			this.features.water_box_mode && adapter.setStateAsync('control.water_box_mode', {
				val: Math.round(status.water_box_mode),
				ack: true
			});
			this.features.dock_status && adapter.setStateAsync('info.dock_status', {
				val: Math.round(status.dock_error_status),
				ack: true
			});
			this.features.mop_mode && adapter.setStateAsync('control.mop_mode', {
				val: Math.round(status.mop_mode),
				ack: true
			});		

			if (this.cleandState !== status.state) {
				this.setRemoteState(status.state);
			}
		} catch (error) {
			adapter.log.debug('ERROR at setGetStatus: ' + error);
			this.Error = true;
		}
	}

	async parseStatus(response) {
		response = response.result[0];
		response.dnd_enabled = response.dnd_enabled === 1;
		response.error_text = errorTexts[response.error_code];
		response.in_cleaning = response.in_cleaning === 1;
		response.map_present = response.map_present === 1;
		//response.state_text= statusTexts[response.state];
		return response;
	}

	/** Parses the answer of get_room_mapping */
	async initStates() {

	}

	// function to control goto params
	async parseGoTo(params) {
		const coordinates = params.split(',');

		if (coordinates.length === 2) {
			const xVal = coordinates[0];
			const yVal = coordinates[1];

			if (!isNaN(yVal) && !isNaN(xVal)) {
				//send goTo request with coordinates
				await this.Miio.sendMessage('app_goto_target', [parseInt(xVal), parseInt(yVal)]);
			} else {
				adapter.log.error('GoTo need two koordinates with type number');
			}

			adapter.log.info('xVAL: ' + xVal + '  yVal:  ' + yVal);
		} else {
			adapter.log.error('GoTo only work with two arguments seperated by ', '');
		}
	}

	async stateChange(id, state) {
		if (!state || state.ack) {
			return;
		}
		const terms = id.split('.');
		const command = terms.pop();
		const parent = terms.pop();

		adapter.log.debug(`command: ${command} parent: ${parent}`);
		// let data;
		// let actionMode, method, params;

		try {
			switch (command) {
				case 'clean_home':
				case 'start':
					if (state.val) {
						adapter.sendTo(adapter.namespace, 'startVacuuming', null);
						if (await this.startCleaning(cleanStates.Cleaning, {})) {
							await this.Miio.sendMessage('app_start');
						}
					} else if (command === 'clean_home' && this.cleanActiveState) {
						this.stopCleaning();
					}
					adapter.setForeignState(id, !!state.val, true);
					break;

				case 'pauseResume':
					if (this.cleanActiveState && activeCleanStates[this.cleanActiveState].resume) {
						this.globalTimeouts['onMessage'] = setTimeout(() => {
							this.setGetStatus();
						}, 2000);				
						if (this.cleandState === cleanStates.Pause) {
							adapter.setState(id, false, true);
							return await this.Miio.sendMessage(activeCleanStates[this.cleanActiveState].resume);
						} else {
							adapter.setState(id, true, true);
							return await this.Miio.sendMessage('app_pause');
						}
					} else {
						adapter.log.error(`Could not pause or Resume, because no cleaning active`);
					}
					break;

				case 'dustCollect':
					if (this.cleandState == cleanStates.DustCollecting) {
						await this.Miio.sendMessage(commands.stopDustCollect.method);
					} else if (this.cleandState == cleanStates.Charging) {
						await this.Miio.sendMessage(commands.startDustCollect.method);
					} else {
						adapter.log.error(`Cant start dust collection only if charging`);
					}
					this.globalTimeouts['onMessage'] = setTimeout(() => {
						this.setGetStatus();
					}, 2000);
					adapter.setState(id, false, true);
					break;

				case 'home':
					if (!state.val) {
						return;
					}
					await this.stopCleaning();
					adapter.setForeignState(id, true, true);
					break;

				case 'loadMap':
					if (!state.val) {
						return;
					}
					await this.getMapPointer();
					adapter.setForeignState(id, true, true);
					break;

				case 'clearQueue':
					if (!state.val) {
						return;
					}
					await this.clearQueue();
					adapter.setForeignState(id, true, true);
					break;

				case 'spotclean':
					if (!state.val) {
						return;
					}
					if (await this.startCleaning(cleanStates.SpotCleaning, {})) {
						await this.Miio.sendMessage('app_spot');
					}
					adapter.setForeignState(id, state.val, true);
					break;

				case 'carpet_mode':
					//when carpetmode change
					if (state.val === true || state.val === 'true') {
						await this.Miio.sendMessage('set_carpet_mode', [enable_carpet_mode]);
						adapter.setForeignState(id, state.val, true);
					} else {
						await this.Miio.sendMessage('set_carpet_mode', [{
							enable: 0
						}]);
						adapter.setForeignState(id, false, true);
					}
					break;

				case 'goTo':
					await this.parseGoTo(state.val);
					adapter.setForeignState(id, state.val, true);
					break;

				case 'zoneClean':
					adapter.sendTo(adapter.namespace, 'cleanZone', state.val);
					adapter.setForeignState(id, '', true);
					break;

				case 'addRoom':
					if (!isNaN(state.val))
						this.roomManager.createRoom('manual_' + state.val, parseInt(state.val, 10));
					else {
						const terms = state.val.match(/((?:[0-9]+,){3,3}[0-9]+)(,[0-9]+)?/);
						if (terms)
							this.roomManager.createRoom('manual_' + terms[1].replace(/,/g, '_'), '[' + terms[1] + (terms[2] || ',1') + ']');
						else
							adapter.log.warn('invalid input for addRoom, use index of map or coordinates like 1111,2222,3333,4444');
					}
					adapter.setForeignState(id, '', true);
					break;

				case 'roomClean':
					if (!state.val) return;
					this.roomManager.cleanRooms([id.replace('roomClean', 'mapIndex')]);
					adapter.setForeignState(id, true, true);
					break;

				case 'roomFanPower':
				case 'roomWaterBoxMode':
				case 'roomMopMode':
						// do nothing, only confirm value for next roomClean
					adapter.setForeignState(id, state.val, true);
					break;

				case 'actualMap':
					await this.Miio.sendMessage('load_multi_map', [state.val]);
					adapter.setForeignState(id, state.val, true);
					this.getStates();
					break;

				default:
					// try to find common command
					if (commands[command]) {
						let params = commands[command].params || '';
						if (state.val !== true && state.val !== 'true') {
							params = state.val;
						}
						if (state.val !== false && state.val !== 'false') {
							await this.Miio.sendMessage(commands[command].method, [params]);
							adapter.setForeignState(id, state.val, true);

							// if consumables reset get data again
							if (commands[command].method === 'reset_consumable') {
								this.globalTimeouts['onMessage'] = setTimeout(() => {
									this.setGetConsumable();
								}, 500);
							}
						}
					} else if (command === 'multiRoomClean' || parent === 'timer') {
						if (parent === 'timer') {
							adapter.setForeignState(id, (state.val == TimerManager.SKIP || state.val == TimerManager.DISABLED) ? state.val : TimerManager.ENABLED, true, () =>
								this.timerManager.calcNextProcess());

							if (state.val != TimerManager.START) {
								return;
							}
						} else {
							if (!state.val) {
								return;
							}
							adapter.setForeignState(id, true, true);
						}
						this.roomManager.cleanRoomsFromState(id);

					} else {
						adapter.log.warn('can not set ' + command);
					}
					break;
			}
		} catch (error) {
			adapter.log.warn(`Cant send command please try again "${command}"\n${error}`);
		}
	}

	async onMessage(obj) {
		adapter.log.debug('We are in onMessage:' + JSON.stringify(obj));
		//return {test: 'true'}
		clearTimeout(this.globalTimeouts['onMessage']);

		function requireParams(params /*: string | string[] */) {
			if (!(params && params.length)) {
				return true;
			}
			if (!obj.message) {
				adapter.log.warn('command needs parameter');
				return false;
			}

			if (typeof params == 'string') { // only one parameter needed, than it could be the message self
				if (!obj.message.hasOwnProperty(params)) { // it is not a member of message
					if (typeof obj.message != "string") {
						adapter.log.warn(`command needs parameter "${params}" or a string`);
						return false;
					}
					const messageObj = {};
					messageObj[params] = obj.message;
					obj.message = messageObj;	// transform message to object with messagecontent to params
				}
			} else {
				for (let i = 0; i < params.length; i++) {
					const param = params[i];
					if (!obj.message.hasOwnProperty(param)) {
						//respond(predefinedResponses.MISSING_PARAMETER(param));
						adapter.log.warn(`command needs parameter "${param}"`);
						return false;
					}
				}
			}
			return true;
		}

		if (obj) {
			let params;

			switch (obj.command) {
				case 'sendCustomCommand':
					// require the method to be given
					if (!requireParams(['method'])) {
						return;
					}
					// params is optional

					params = obj.message;
					return await this.Miio.sendMessage(params.method, params.params);

				// ======================================================================
				// support for the commands mentioned here:
				// https://github.com/MeisterTR/XiaomiRobotVacuumProtocol#vaccum-commands

				// cleaning commands
				case 'startVacuuming':
					const answer = await this.Miio.sendMessage('app_start');
					this.globalTimeouts['onMessage'] = setTimeout(this.setGetStatus, 2000);
					return answer;

				case 'stopVacuuming':
					return await this.Miio.sendMessage('app_stop');

				case 'clearQueue':
					return this.clearQueue();

				case 'cleanSpot':
					if (await this.startCleaning(cleanStates.SpotCleaning, {})) {
						return await this.Miio.sendMessage('app_spot');
					}
					return;

				case 'cleanZone':
					if (!obj.message) {
						return adapter.log.warn('cleanZone needs parameter coordinates');
					}
					if (!obj.zones) { // this data called first time!
						const message = obj.message;
						if (message.zones) { // called from roomManager with correct Array
							obj.zones = message.zones;
							obj.channels = message.channels;
							obj.message = obj.zones.join(); // we use String for message
						} else {
							if (message.hasOwnProperty('coordinates')) {
								if (message.hasOwnProperty('waterBoxMode'))
									obj.waterBoxMode = message.waterBoxMode;
								if (message.hasOwnProperty('mopMode'))
									obj.mopMode = message.mopMode;
								if (message.hasOwnProperty('fanSpeed'))
									obj.fanSpeed = message.fanSpeed;
								obj.zones = [message.coordinates];
							} else
								obj.zones = [obj.message];
						}
					}

					if (typeof obj.channels == 'undefined') {
						return this.roomManager.findChannelsByMapIndex(obj.zones, channels => {
							adapter.log.debug('search channels for ' + obj.message + ' ->' + channels.join());
							obj.channels = channels && channels.length ? channels : null;
							adapter.emit('message', obj); // call function again
						});
					}

					if (await this.startCleaning(cleanStates.ZoneCleaning, obj)) {
						return await this.Miio.sendMessage('app_zoned_clean', obj.zones);
					}

					return;

				case 'cleanSegments':
					if (!obj.message) {
						return adapter.log.warn('cleanSegments needs paramter mapIndex');
					}
					if (!obj.segments) { // this data called first time!
						let message = obj.message;
						if (message.segments) { // called from roomManager with correct Array
							obj.segments = message.segments;
							obj.channels = message.channels;
							obj.message = obj.segments.join(); // we use String for message
						} else { // build correct Array
							if (typeof message == 'object' && message.hasOwnProperty('rooms')) {
								if (message.hasOwnProperty('waterBoxMode'))
									obj.waterBoxMode = message.waterBoxMode;
								if (message.hasOwnProperty('mopMode'))
									obj.mopMode = message.mopMode;
								if (message.hasOwnProperty('fanSpeed'))
									obj.fanSpeed = message.fanSpeed;
								message = message.rooms;
							}
							if (!isNaN(message)) { // only one number
								message = [parseInt(message, 10)];
							} else {
								if (typeof message == 'string') { // we expect String with comma seperate Numbers, like "11,12,13"
									message = obj.message.split(',');
								} 
								for (const i in message) {
									message[i] = parseInt(message[i], 10);
									if (isNaN(message[i])) {
										delete message[i];
									}
								}
							}
							obj.segments = message;
						}
					}

					if (typeof obj.channels === 'undefined') {
						return this.roomManager.findChannelsByMapIndex(obj.segments, channels => {
							adapter.log.debug('search channels for ' + obj.message + ' ->' + channels.join());
							obj.channels = channels && channels.length ? channels : null;
							adapter.emit('message', obj); // call function again
						});
					}

					if (await this.startCleaning(cleanStates.RoomCleaning, obj)) {
						//setTimeout(()=> {cleaning.setRemoteState(cleanStates.RoomCleaning)},2500) //simulate:
						return await this.Miio.sendMessage('app_segment_clean', obj.segments);
					}

					return;

				case 'cleanRooms':
					if (!requireParams('rooms')) {
						return;
					}
					this.roomManager.findMapIndexByRoom(obj.message.rooms, this.roomManager.cleanRooms);
					return;

				case 'pause':
					this.globalTimeouts['onMessage'] = setTimeout(() => {
						this.setGetStatus();
					}, 2000);
					return this.Miio.sendMessage('app_pause');

				case 'charge':
					this.globalTimeouts['onMessage'] = setTimeout(() => {
						this.setGetStatus();
					}, 2000);
					return this.Miio.sendMessage('app_charge');

				case 'findMe':
					return await this.Miio.sendMessage('find_me');

				case 'getConsumableStatus':
					return await this.Miio.sendMessage('get_consumable');

				case 'resetConsumables':
					if (!requireParams('consumable')) {
						return;
					}
					this.globalTimeouts['onMessage'] = setTimeout(() => {
						this.setGetStatus();
					}, 2000);
					return await this.Miio.sendMessage('reset_consumable', obj.message.consumable);

				// get info about cleanups
				case 'getCleaningSummary':
					return await this.Miio.sendMessage('reset_consumable', obj.message.consumable);

				case 'getCleaningRecord':
					// require the record id to be given
					if (!requireParams('recordId')) {
						return;
					}
					// TODO: can we do multiple at once?
					return await this.Miio.sendMessage('get_clean_record', [obj.message.recordId]);

				// TODO: find out how this works
				// case 'getCleaningRecordMap':
				//     sendCustomCommand('get_clean_record_map');
				case 'getMap':
					return await this.Miio.sendMessage('get_map_v1');

				// Basic information
				case 'getStatus':
					return await this.Miio.sendMessage('get_status');

				case 'getSerialNumber':
					return await this.Miio.sendMessage('get_serial_number');

				case 'getDeviceDetails':
					return await this.Miio.sendMessage('miIO.info');

				// Do not disturb
				case 'getDNDTimer':
					return await this.Miio.sendMessage('get_dnd_timer');

				case 'setDNDTimer':
					// require start and end time to be given
					if (!requireParams(['startHour', 'startMinute', 'endHour', 'endMinute'])) {
						return;
					}
					params = obj.message;
					return await this.Miio.sendMessage('set_dnd_timer', [params.startHour, params.startMinute, params.endHour, params.endMinute]);

				case 'deleteDNDTimer':
					return await this.Miio.sendMessage('close_dnd_timer');

				// Fan speed
				case 'getFanSpeed':
					return await this.Miio.sendMessage('get_custom_mode');
				//break;
				case 'setFanSpeed':
					if (!requireParams('fanSpeed')) {
						return;
					}
					//sendCustomCommand('set_custom_mode', [obj.message.fanSpeed]);
					return await this.Miio.sendMessage('set_custom_mode', [obj.message.fanSpeed]);

				//Water Flow Mode
				case 'getWaterBoxMode':
					return await this.Miio.sendMessage('get_water_box_custom_mode');

				case 'setWaterBoxMode':
					//require start and end time to be given
					if (!requireParams('waterBoxMode')) {
						return;
					}
					return await this.Miio.sendMessage('set_water_box_custom_mode', [obj.message.waterBoxMode]);

				//Mop Mode
				case 'getMopMode':
					return await this.Miio.sendMessage('get_mop_mode');

				case 'setMopMode':
					if (!requireParams('mopMode')) {
						return;
					}
					return await this.Miio.sendMessage('set_mop_mode', [obj.message.mopMode]);

				// Remote controls
				case 'startRemoteControl':
					return await this.Miio.sendMessage('app_rc_start');

				case 'get_prop':
					return await this.Miio.sendMessage('get_prop', obj.message);

				case 'stopRemoteControl':
					return await this.Miio.sendMessage('app_rc_end');

				case 'move':
					// require all params to be given
					if (!requireParams(['velocity', 'angularVelocity', 'duration', 'sequenceNumber'])) {
						return;
					}
					// TODO: Constrain the params
					params = obj.message;
					// TODO: can we issue multiple commands at once?
					const args = [{
						omega: params.angularVelocity,
						velocity: params.velocity,
						seqnum: params.sequenceNumber, // <- TODO: make this automatic
						duration: params.duration
					}];
					return await this.Miio.sendMessage('app_rc_move', [args]);

				// ======================================================================
				default:
					//respond(predefinedResponses.ERROR_UNKNOWN_COMMAND);
					return;
			}
		}
	}

	//_________________________________
	// vacuum State control
	//__________________________________

	/**
	 * is called, if robot send status
	 * @param {number} newVal new status
	 */
	async setRemoteState(newVal) {
		this.cleandState = newVal;
		adapter.setState('control.pauseResume', this.cleandState === cleanStates.Pause, true);

		if (activeCleanStates[this.cleandState]) {
			if (newVal === this.cleanActiveState) { // cleanActiveState was set in startCleaning and now confirmed
				if (this.activeChannels) {
					for (const i in this.activeChannels) {
						adapter.setState(this.activeChannels[i] + '.state', i18n.cleanRoom, true);
					}
				}
			} else {
				this.cleanActiveState = this.cleandState;
			}
		} else if (cleanStates.Pause === this.cleandState) {
			// cleanActiveState should be the initial State, so do nothing
			return;
		} else {
			this.cleanActiveState = 0;
			if (this.activeChannels) {
				for (const i in this.activeChannels) {
					adapter.setState(this.activeChannels[i] + '.state', '', true);
				}
				this.activeChannels = null;
			}
			if ([cleanStates.Sleeping, cleanStates.Waiting, cleanStates.Back_toHome, cleanStates.Charging, cleanStates.GoingToSpot].includes(this.cleandState)) {
				if (this.queue.length > 0) {
					adapter.log.debug('use clean trigger from Queue');
					adapter.emit('message', this.queue.shift());
					this.updateQueue();
				}
			}
			if (cleanStates.Charging === newVal) {
				// update values
				await this.setGetConsumable();
				await this.setGetCleanSummary();
				//MAP.ENABLED && setTimeout(sendMsg, 2000, 'get_map_v1');
			}
		}
		// if (this.checkCleanState)
		// 	this.checkCleanState = !!clearTimeout(this.checkCleanState);

		/*if (adapter.config.enableAlexa) */
		adapter.setState('control.clean_home', !!this.cleanActiveState, true);

		if (this.mapEnable) { // set map getter to true if..
			if ([cleanStates.Cleaning, cleanStates.Back_toHome, cleanStates.SpotCleaning, cleanStates.GoingToSpot, cleanStates.ZoneCleaning, cleanStates.RoomCleaning].indexOf(this.cleandState) > -1) {
				this.mapGet = true;
				this.getMapPointer();
			} else {
				this.mapGet = false;
			}
		}
	}

	async startCleaning(cleanStatus, messageObj) {
		adapter.log.debug(`start Cleaning: ${cleanStatus} MObj: ${JSON.stringify(messageObj)}`);
		const activeCleanState = activeCleanStates[cleanStatus];
		if (!activeCleanState) {
			adapter.log.warn(`Invalid cleanStatus(${cleanStatus}) for startCleaning`);
			return false;
		}

		// why??? setTimeout(sendPing, 2000);
		if (this.cleanActiveState) {
			if (cleanStatus === cleanStates.Cleaning && adapter.config.enableResumeZone) {
				adapter.log.debug('Resuming paused ' + activeCleanStates[this.cleanActiveState].name);
				await this.Miio.sendMessage(activeCleanStates[this.cleanActiveState].resume);
			} else {
				adapter.log.info(`should trigger cleaning ${activeCleanState.name}${messageObj.message || ''}, but is currently active(${this.cleanActiveState}). Add to queue`);
				messageObj.info = activeCleanState.name;
				this.push(messageObj);
			}
			return false;
		} else {
			this.cleanActiveState = cleanStatus;
			this.activeChannels = messageObj.channels;
			if (this.activeChannels && this.activeChannels.length === 1) {
				if (!messageObj.fanSpeed) {
					adapter.getState(this.activeChannels[0] + '.roomFanPower', (err, fanPower) =>
						fanPower && adapter.setState('control.fan_power', fanPower.val));
				}
				if (this.features.water_box_mode != null && !messageObj.waterBoxMode) {
					adapter.getState(this.activeChannels[0] + '.roomWaterBoxMode', (err, waterBoxMode) =>
						waterBoxMode && adapter.setState('control.water_box_mode', waterBoxMode.val));
				}
				if (this.features.mop_mode != null && !messageObj.mopMode) {
					adapter.getState(this.activeChannels[0] + '.roomMopMode', (err, mopMode) =>
						mopMode && adapter.setState('control.mop_mode', mopMode.val));
				}
			}
			if (messageObj.fanSpeed) {
				adapter.setState('control.fan_power', messageObj.fanSpeed);
			}
			if (messageObj.waterBoxMode && this.features.water_box_mode != null) {
				adapter.setState('control.water_box_mode', messageObj.waterBoxMode);
			}
			if (messageObj.mopMode && this.features.mop_mode != null) {
				adapter.setState('control.mop_mode', messageObj.mopMode);
			}
			adapter.log.info('trigger cleaning ' + activeCleanState.name + (messageObj.message || ''));
			/// need to verify?? this.checkStartCleaning(2);
			return true;
		}
	}

	async stopCleaning() {
		try {
			if (adapter.config.sendPauseBeforeHome) await this.Miio.sendMessage('app_pause');
			this.clearQueue();
			this.cleandState = cleanStates.Unknown; // Force calling setRemoteState on next get_status answer
			await this.Miio.sendMessage('app_charge');
			this.setGetStatus();
		} catch (error) {
			adapter.log.warn('Error at stop Cleaning: ' + error);
		}

	}

	clearQueue() {
		for (const i in this.queue) {
			const channels = this.queue[i].channels;
			if (channels) {
				for (const c in channels) {
					adapter.setState(channels[c] + '.state', '', true);
				}
			}
		}
		this.queue = [];
		this.updateQueue();
	}

	push(messageObj) {
		this.queue.push(messageObj);
		if (messageObj.channels) {
			const getObjs = [];
			for (const i in messageObj.channels) {
				getObjs.push(adapter.getObjectAsync(messageObj.channels[i])
					.then(obj => {
						if (obj && obj.common) {
							messageObj.info += ' ' + obj.common.name;
						}
					}));
			}

			Promise.all(getObjs)
				.then(() =>
					this.updateQueue());
		} else {
			this.updateQueue();
		}
	}

	updateQueue() {
		// pingInterval = this.queue.length > 0 ? 10000 : adapter.config.pingInterval;
		const json = [];
		for (let i = this.queue.length - 1; i >= 0; i--) {
			json.push(this.queue[i].info);
			const channels = this.queue[i].channels;
			if (channels) {
				for (const c in channels) {
					adapter.setState(channels[c] + '.state', i18n.waitingPos + ': ' + i, true);
				}
			}
		}
		adapter.setStateChanged('info.queue', JSON.stringify(json), true);
	}

	async close() {
		Object.keys(this.globalTimeouts).forEach(id => this.globalTimeouts[id] && clearTimeout(this.globalTimeouts[id]));
		this.globalTimeouts = {};
	}

}

class FeatureManager {
	constructor() {
		this.model = null;
		//this.goto = false;
		this.zoneClean = false;
		this.mop_mode = null;
		this.water_box = null;
		this.water_filter = null;
		this.water_box_mode = null;
		this.dustCollect = null;
		this.roomMapping = null;
		this.NewSuctionPower = null;
		this.mop = null;
		this.dock_status = null;
	}

	init() {
		//adapter.states
		//roomManager = new RoomManager(adapter, i18n);
		//timerManager = new TimerManager(adapter, i18n);

		adapter.getState('info.device_model', (err, state) =>
			state && state.val && this.setModel(state.val));

		// we get miIO.info only, if the robot is connected to the internet, so we init with unavailable
		adapter.setState('info.wifi_signal', null, true);
	}

	detect() {
		//sendMsg(commands.get_carpet_mode.method); // test, if supported
		//sendMsg('get_room_mapping'); // test, if supported
	}

	async setNewSuctionValues(value) {
		if (this.NewSuctionPower === null && value > 100) {
			adapter.log.info('change states from State control.fan_power');

			if (['roborock.vacuum.a27'].indexOf(Vacuum.modell) >= 0){
				objects.newfan_power.common.max= 108;
				objects.newfan_power.common.states['105'] = 'OFF';
				objects.newfan_power.common.states['108'] = 'MAXIMUM+';
			}
			this.NewSuctionPower = true;
			adapter.setObjectAsync('control.fan_power', objects.newfan_power);
			adapter.getStates('rooms.*.roomFanPower', (err, states) => {
				if (states) {
					for (let stateId in states) {
						adapter.log.info('change states from State control.fan_power ' + stateId);
						adapter.setObjectAsync(stateId, objects.newfan_power);
					}
				}
			});
		} else if (this.NewSuctionPower === null && value <= 100) {
			this.NewSuctionPower = false;
		}
	}

	setModel(model) {
		// First Viomi detection
		if (this.model !== model) {
			adapter.setStateChanged('info.device_model', model, true);
			this.model = model;
		}
	}
	async setWaterBox(water_box_status) {
		if (this.water_box === null) {
			this.water_box = !isNaN(water_box_status);
			if (this.water_box) {
				adapter.log.info('create states for water box');
				await adapter.setObjectNotExistsAsync('info.water_box', objects.water_box);
			}
		}
	}
	async setDustCollect(dust_collection_status) {
		if (this.dustCollect === null) {
			this.dustCollect = !isNaN(dust_collection_status);
			if (this.dustCollect) {
				adapter.log.info('create states for dust collecting');
				await adapter.setObjectNotExistsAsync('control.dustCollect', objects.dustCollect);
			}
		}
	}
	async setMop(mop_status) {
		if (typeof mop_status === 'undefined') {
			return;
		}

		if (this.mop === null) {
			this.mop = !isNaN(mop_status);
			if (this.mop) {
				adapter.log.info('create states for mop');
				await adapter.setObjectNotExistsAsync('info.mop', objects.mop);
				objects.newfan_power.common.states['105'] = 'OFF'; // if mop mode than fan is off
			}
		}

		adapter.setStateAsync('info.mop', {
			val: !!mop_status,
			ack: true
		});
	}

	async setWaterFilter() {
		if (this.water_filter === null) {
			this.water_filter = true;
			adapter.log.info('create states for water box filter');
			await Promise.all(objects.water_filter.map(async o => {
				const contents = await adapter.setObjectNotExistsAsync('consumable.' + o._id, o);
				adapter.log.debug('Create State for water_filter ' + JSON.stringify(contents));
			}));
		}
	}

	async setWaterBoxMode(water_box_mode) {
		if (this.water_box_mode === null && water_box_mode) {
			this.water_box_mode = !isNaN(water_box_mode);
			if (this.water_box_mode) {
				adapter.log.info('create states for water box mode');
				await adapter.setObjectNotExistsAsync('control.water_box_mode', objects.water_box_mode);
			}
		}
	}

	async setMopMode(mop_mode) {
		if (this.mop_mode === null && mop_mode) {
			this.mop_mode = !isNaN(mop_mode);
			if (this.mop_mode) {
				adapter.log.info('create states for mop mode');
				await adapter.setObjectNotExistsAsync('control.mop_mode', objects.mop_mode);
			}
		}
	}

	async setDockStatus(dock_status) {
		if (this.dock_status === null && typeof dock_status != 'undefined') {
			this.dock_status = !isNaN(dock_status);
			if (this.dock_status) {
				adapter.log.info('create states for dock status');
				await adapter.setObjectNotExistsAsync('info.dock_status', objects.dock_status);
			}
		}
	}
}

module.exports = VacuumManager;
