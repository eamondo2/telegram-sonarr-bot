/* global __dirname */

'use strict';

var SonarrAPI = require('sonarr-api');
var _         = require('lodash');
var moment    = require('moment');

var i18n   = require(__dirname + '/../lib/lang');
var config = require(__dirname + '/../lib/config');
var state  = require(__dirname + '/../lib/state');
var logger = require(__dirname + '/../lib/logger');
var acl    = require(__dirname + '/../lib/acl');

/*
 * initalize the class
 */
function SonarrMessage(bot, user, chat, cache) {
    this.bot      = bot;
    this.user     = user;
    this.chat     = chat;
    this.cache    = cache;
    this.adminId  = config.bot.owner;
    this.username = this.user.username || (this.user.first_name + (' ' + this.user.last_name || ''));

    this.sonarr = new SonarrAPI({
        hostname : config.sonarr.hostname,
        apiKey   : config.sonarr.apiKey,
        port     : config.sonarr.port,
        urlBase  : config.sonarr.urlBase,
        ssl      : config.sonarr.ssl,
        username : config.sonarr.username,
        password : config.sonarr.password
    });
}

function formatBytes(bytes,decimals) {
    if(bytes == 0) return '0 Bytes';
    var k = 1024,
        dm = decimals || 2,
        sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
        i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/*
 * perform commands
 */
SonarrMessage.prototype.getDiskUsage = function() {
    var self = this;
    self.sonarr.get('diskspace').then(function(result) {

        _.sortBy(result, 'freeSpace');

        var response = [];

        _.forEach(result, function(n, key) {

            var usageRes = '[[ ' + n.path + ' ]] ' + (n.freeSpace / n.totalSpace) + '% ' + '| ' + formatBytes(n.freeSpace) + ' free.';
            response.push(usageRes);  

        });

        if (!response.length) {
            throw new Error(i18n.__('errorNoDisksFound'));
        }

        response.sort();

        response.unshift(i18n.__('botChatSonarrDiskUsage'));

        if (response.length > 50) {
            var splitReponse = _.chunk(response, 50);
            splitReponse.sort();
            var i = 0;
            var libraryLoop = setInterval(function () {
                var n = splitReponse[i];
                if (n === undefined) {
                    clearInterval(libraryLoop);
                } else {
                    n.sort();
                    self._sendMessage(n.join('\n'), []);
                }
                i = i + 1;
            }, 200);
        } else {
            return self._sendMessage(response.join('\n'), []);
        }

    }).catch(function(error) {
        return self._sendMessage(error);
    });
};

SonarrMessage.prototype.performLibrarySearch = function(searchText) {
    var self = this;

    var query = searchText;

    self.sonarr.get('series').then(function(result) {
        logger.info(i18n.__('logSonarrAllSeries',self.username));

        _.sortBy(result, 'title');

        var response = [];
        _.forEach(result, function(n, key) {
            var series = '[' + n.title + '](http://thetvdb.com/?tab=series&id=' + n.tvdbId + ')' + (n.year ? ' - _' + n.year + '_' : '');
            if (query) {
                if (n.title.search( new RegExp(query, 'i') ) !== -1) {
                    response.push(series);
                }
            } else {
                response.push(series);
            }
        });

        if (!response.length) {
            throw new Error(i18n.__('errorSonarrUnableToLocate', query));
        }

        response.sort();

        if (query) {
            // add title to begining of the array
            response.unshift(i18n.__('botChatSonnarMatchingResults'));
        }

        if (response.length > 50) {
            var splitReponse = _.chunk(response, 50);
            splitReponse.sort();
            var i = 0;
            var libraryLoop = setInterval(function () {
                var n = splitReponse[i];
                if (n === undefined) {
                    clearInterval(libraryLoop);
                } else {
                    n.sort();
                    self._sendMessage(n.join('\n'), []);
                }
                i = i + 1;
            }, 200);
        } else {
            return self._sendMessage(response.join('\n'), []);
        }

    }).catch(function(error) {
        return self._sendMessage(error);
    });

};

SonarrMessage.prototype.performRssSync = function() {
    var self = this;

    logger.info(i18n.__('logSonarrRSSCommandSent'));

    self.sonarr.post('command', { 'name': 'RssSync' })
        .then(function() {
            logger.info('logSonarrRSSCommandExecuted', self.username);
            return self._sendMessage(i18n.__('botChatSonnarRSSCommandExecuted'));
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

SonarrMessage.prototype.performWantedSearch = function() {
    var self = this;

    logger.info(i18n.__('logSonarrWantedCommandSent', self.username));

    self.sonarr.get('/wanted/missing', {
        'page': 1,
        'pageSize': 50,
        'sortKey': 'airDateUtc',
        'sortDir': 'desc'
    })
        .then(function(wantedEpisodes) {
            var episodeIds = [];
            _.forEach(wantedEpisodes.records, function(n, key) {
                episodeIds.push(n.id);
            });
            return episodeIds;
        })
        .then(function(episodes) {
            self.sonarr.post('command', {
                'name': 'EpisodeSearch',
                'episodeIds': episodes
            })
                .then(function() {
                    logger.info(i18n.__('logSonarrWantedCommandExecuted', self.username));
                    return self._sendMessage(i18n.__('botChatSonarrWantedCommandExecuted'));
                })
                .catch(function(error) {
                    return self._sendMessage(error);
                });
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

SonarrMessage.prototype.performLibraryRefresh = function() {
    var self = this;

    logger.info(i18n.__('logSonarrRefreshCommandSent', self.username));

    self.sonarr.post('command', {
        'name': 'RefreshSeries'
    })
        .then(function() {
            logger.info(i18n.__('logSonarrRefreshCommandExecuted', self.username));
            return self._sendMessage(i18n.__('botChatSonarrRefreshCommandExecuted'));
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

SonarrMessage.prototype.performCalendarSearch = function(futureDays) {
    var self = this;

    var fromDate = moment().toISOString();
    var toDate = moment().add(futureDays, 'day').toISOString();

    logger.info(i18n.__('logSonarrUpcomingCommandSent', self.username, fromDate, toDate));

    self.sonarr.get('calendar', { 'start': fromDate, 'end': toDate})
        .then(function (episode) {
            if (!episode.length) {
                throw new Error(i18n.__('errorSonarrNothingInCalendar'));
            }

            var lastDate = null;
            var response = [];
            _.forEach(episode, function(n, key) {
                var done = (n.hasFile ? i18n.__('SonarrDone') : '');

                // Add an empty line to break list of multiple days
                if(lastDate != null && n.airDate != lastDate) response.push(' ');

                response.push(n.airDate + ' - ' + n.series.title + done);
                lastDate = n.airDate;
            });

            logger.info(i18n.__('logSonarrFoundSeries', self.username, response.join(',')));

            return self._sendMessage(response.join('\n'), []);
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};


/*
 * handle the flow of adding a new series
 */
SonarrMessage.prototype.sendSeriesList = function(seriesName) {
    var self = this;

    self.test = 'hello';

    logger.info(i18n.__('logSonarrQueryCommandSent', self.username));

    self.sonarr.get('series/lookup', { 'term': seriesName }).then(function(result) {
        if (!result.length) {
            throw new Error(i18n.__('errorSonarrSerieNotFound', seriesName));
        }

        var series = result;

        logger.info(i18n.__('logSonarrUserSerieRequested', self.username, seriesName));

        var seriesList = [], keyboardList = [];

        series.length = (series.length > config.bot.maxResults ? config.bot.maxResults : series.length);

        var response = [i18n.__('botChatSonarrFoundNSeries', series.length)];

        _.forEach(series, function(n, key) {

            var imageCover = null;
            _.forEach(n.images, function(image, index){
                if(image.coverType === 'poster'){
                    imageCover = image.url;
                }
            });

            var id = key + 1;
            var keyboardValue = n.title + (n.year ? ' - ' + n.year : '');

            seriesList.push({
                'id': id,
                'title': n.title,
                'plot': n.overview,
                'year': n.year,
                'tvdbId': n.tvdbId,
                'titleSlug': n.titleSlug,
                'seasons': n.seasons,
                'keyboardValue': keyboardValue,
                'coverUrl': imageCover
            });

            keyboardList.push([keyboardValue]);

            response.push('➸ ['+keyboardValue+'](http://thetvdb.com/?tab=series&id='+n.tvdbId+')');
        });

        response.push(i18n.__('selectFromMenu'));

        logger.info(i18n.__('logSonarrFoundSeries2', self.username, keyboardList.join(',')));

        // set cache
        self.cache.set('seriesList' + self.user.id, seriesList);
        self.cache.set('state' + self.user.id, state.sonarr.CONFIRM);

        return self._sendMessage(response.join('\n'), keyboardList);
    })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

SonarrMessage.prototype.confirmShowSelect = function(displayName) {
    var self = this;

    var seriesList = self.cache.get('seriesList' + self.user.id);

    if (!seriesList) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var series = _.filter(seriesList, function(item) { return item.keyboardValue === displayName; })[0];
    if (!series) {
        return self._sendMessage(new Error(i18n.__('botChatSonarrSerieNotFound', displayName)));
    }

    // use workflow to run async tasks
    var workflow = new (require('events').EventEmitter)();

    // check for existing series on sonarr
    workflow.on('checkSonarrSeries', function () {
        self.sonarr.get('series').then(function(result) {
            logger.info(i18n.__('logSonarrLookingForExistingSeries', self.username));

            var existingSeries = _.filter(result, function(item) { return item.tvdbId === series.tvdbId; })[0];
            if (existingSeries) {
                throw new Error(i18n.__('errorSonarrSerieAlreadyTracked'));
            }
            workflow.emit('confirmShow');
        }).catch(function(error) {
            return self._sendMessage(error);
        });
    });

    // check for existing series on sonarr
    workflow.on('confirmShow', function () {
        self.sonarr.get('series').then(function(result) {
            logger.info(i18n.__('logSonarrConfirmCorrectShow', series.keyboardValue, self.username));

            var keyboardList = [[i18n.__('globalYes')], [i18n.__('globalNo')]];

            var response = ['*' + series.title + ' (' + series.year + ')*\n'];

            response.push(series.plot + '\n');
            response.push(i18n.__('botChatSonarrIsShowCorrect'));
            response.push(i18n.__('globalArrowYes'));
            response.push(i18n.__('globalArrowNo'));

            // Add cover to message (if available)
            if(series.coverUrl !== null){
                response.push('\n[Poster!](' + series.coverUrl + ')');
            }

            // set cache
            self.cache.set('state' + self.user.id, state.sonarr.PROFILE);
            self.cache.set('seriesId' + self.user.id, series.id);

            return self._sendMessage(response.join('\n'), keyboardList);

        }).catch(function(error) {
            return self._sendMessage(error);
        });
    });

    /**
   * Initiate the workflow
   */
    workflow.emit('checkSonarrSeries');
};

SonarrMessage.prototype.sendProfileList = function(displayName) {
    var self = this;

    var seriesId = self.cache.get('seriesId' + self.user.id);

    if (!seriesId) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    if(displayName == 'No'){
        return self._sendMessage(new Error(i18n.__('globalAborted')));
    }

    // use workflow to run async tasks
    var workflow = new (require('events').EventEmitter)();

    // get the sonarr profiles
    workflow.on('getSonarrProfiles', function () {
        self.sonarr.get('profile').then(function(result) {
            if (!result.length) {
                throw new Error(i18n.__('errorSonarrCouldntGetProfile'));
            }

            var profiles = result;

            logger.info(i18n.__('logSonarrProfileListRequested', self.username));

            var profileList = [], keyboardList = [], keyboardRow = [];
            var response = ['*Found ' + profiles.length + ' profiles*'];
            _.forEach(profiles, function(n, key) {

                profileList.push({ 'name': n.name, 'profileId': n.id });
                response.push('➸ ' + n.name);

                // Profile names are short, put two on each custom
                // keyboard row to reduce scrolling
                keyboardRow.push(n.name);
                if (keyboardRow.length === 2) {
                    keyboardList.push(keyboardRow);
                    keyboardRow = [];
                }
            });

            if (keyboardRow.length === 1) {
                keyboardList.push([keyboardRow[0]]);
            }

            response.push(i18n.__('selectFromMenu'));

            logger.info(i18n.__('logSonarrFoundProfile', self.username, keyboardList.join(',')));

            // set cache
            self.cache.set('state' + self.user.id, state.sonarr.MONITOR);
            self.cache.set('seriesProfileList' + self.user.id, profileList);

            return self._sendMessage(response.join('\n'), keyboardList);
        })
            .catch(function(error) {
                return self._sendMessage(error);
            });
    });

    /**
   * Initiate the workflow
   */
    workflow.emit('getSonarrProfiles');
};

SonarrMessage.prototype.sendMonitorList = function(profileName) {
    var self = this;

    var profileList = self.cache.get('seriesProfileList' + self.user.id);
    if (!profileList) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var profile = _.filter(profileList, function(item) { return item.name === profileName; })[0];
    if (!profile) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    logger.info(i18n.__('logSonarrMonitorListRequest', self.username));

    var monitor = ['future', 'all', 'none', 'latest', 'first'];
    var monitorList = [], keyboardList = [], keyboardRow = [];
    var response = [i18n.__('botChatSonarrSelectSeason')];
    _.forEach(monitor, function(n, key) {
        monitorList.push({ 'type': n });

        response.push('➸ ' + n);

        keyboardRow.push(n);
        if (keyboardRow.length === 2) {
            keyboardList.push(keyboardRow);
            keyboardRow = [];
        }
    });

    if (keyboardRow.length === 1) {
        keyboardList.push([keyboardRow[0]]);
    }

    response.push(i18n.__('selectFromMenu'));

    logger.info(i18n.__('logSonarrFoundMonitorType', self.username, keyboardList.join(',')));

    self.cache.set('seriesProfileId' + self.user.id, profile.profileId);
    self.cache.set('seriesMonitorList' + self.user.id, monitorList);
    self.cache.set('state' + self.user.id, state.sonarr.TYPE);

    return self._sendMessage(response.join('\n'), keyboardList);
};

SonarrMessage.prototype.sendTypeList = function(monitorName) {
    var self = this;

    var monitorList = self.cache.get('seriesMonitorList' + self.user.id);
    if (!monitorList) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var monitor = _.filter(monitorList, function(item) { return item.type === monitorName; })[0];
    if (!monitor) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    logger.info(i18n.__('logSonarrUserSeriesTypeRequested', self.username));

    var type = ['standard', 'airs daily', 'anime'];
    var typeList = [], keyboardList = [], keyboardRow = [];
    var response = [i18n.__('selectSeriesType')];
    _.forEach(type, function(n, key) {
        typeList.push({ 'type': n });

        response.push('➸ ' + n);

        keyboardRow.push(n);
        if (keyboardRow.length === 2) {
            keyboardList.push(keyboardRow);
            keyboardRow = [];
        }
    });

    if (keyboardRow.length === 1) {
        keyboardList.push([keyboardRow[0]]);
    }

    response.push(i18n.__('selectFromMenu'));

    logger.info(i18n.__('logSonarrFoundSeriesType', self.username, keyboardList.join(',')));

    self.cache.set('seriesMonitorId' + self.user.id, monitor.type);
    self.cache.set('seriesTypeList' + self.user.id, typeList);
    self.cache.set('state' + self.user.id, state.sonarr.FOLDER);

    return self._sendMessage(response.join('\n'), keyboardList);
};

SonarrMessage.prototype.sendFolderList = function(typeName) {
    var self = this;

    var typeList = self.cache.get('seriesTypeList' + self.user.id);
    if (!typeList) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var type = _.filter(typeList, function(item) { return item.type === typeName; })[0];
    if (!type) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    self.sonarr.get('rootfolder').then(function(result) {
        if (!result.length) {
            throw new Error(i18n.__('errorSonarrCouldntFindFolders'));
        }

        var folders = result;

        logger.info(i18n.__('logSonarrFolderListRequested', self.username));

        var folderList = [], keyboardList = [];
        var response = ['*Found ' + folders.length + ' folders*'];
        _.forEach(folders, function(n, key) {
            folderList.push({ 'path': n.path, 'folderId': n.id });

            response.push('➸ ' + n.path);

            keyboardList.push([n.path]);
        });
        response.push(i18n.__('selectFromMenu'));

        logger.info(i18n.__('logSonarrFoundFolders', self.username, keyboardList.join(',')));

        // set cache
        self.cache.set('seriesTypeId' + self.user.id, type.type);
        self.cache.set('seriesFolderList' + self.user.id, folderList);
        self.cache.set('state' + self.user.id, state.sonarr.SEASON_FOLDER);

        return self._sendMessage(response.join('\n'), keyboardList);
    })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

SonarrMessage.prototype.sendSeasonFolderList = function(folderName) {
    var self = this;

    var folderList = self.cache.get('seriesFolderList' + self.user.id);
    if (!folderList) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var folder = _.filter(folderList, function(item) { return item.path === folderName; })[0];
    if (!folder) {
        return self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    logger.info(i18n.__('logSonarrSeasonFoldersListRequested', self.username));

    var seasonFolder = [i18n.__('globalYes'), i18n.__('globalNo')];
    var seasonFolderList = [], keyboardList = [], keyboardRow = [];
    var response = [i18n.__('askUsingSeasonFolders')];
    _.forEach(seasonFolder, function(n, key) {
        seasonFolderList.push({ 'type': n });

        response.push('➸ ' + n);

        keyboardRow.push(n);
        if (keyboardRow.length === 2) {
            keyboardList.push(keyboardRow);
            keyboardRow = [];
        }
    });

    if (keyboardRow.length === 1) {
        keyboardList.push([keyboardRow[0]]);
    }

    response.push(i18n.__('selectFromMenu'));

    logger.info(i18n.__('logSonarrFoundSeasonsFolderTypes', self.username, keyboardList.join(',')));

    self.cache.set('seriesFolderId' + self.user.id, folder.folderId);
    self.cache.set('seriesSeasonFolderList' + self.user.id, seasonFolderList);
    self.cache.set('state' + self.user.id, state.sonarr.ADD_SERIES);

    return self._sendMessage(response.join('\n'), keyboardList);
};

SonarrMessage.prototype.sendAddSeries = function(seasonFolderName) {
    var self = this;

    var seriesId         = self.cache.get('seriesId' + self.user.id);
    var seriesList       = self.cache.get('seriesList' + self.user.id);
    var profileId        = self.cache.get('seriesProfileId' + self.user.id);
    var profileList      = self.cache.get('seriesProfileList' + self.user.id);
    var monitorId        = self.cache.get('seriesMonitorId' + self.user.id);
    var monitorList      = self.cache.get('seriesMonitorList' + self.user.id);
    var typeId           = self.cache.get('seriesTypeId' + self.user.id);
    var typeList         = self.cache.get('seriesTypeList' + self.user.id);
    var folderId         = self.cache.get('seriesFolderId' + self.user.id);
    var folderList       = self.cache.get('seriesFolderList' + self.user.id);
    var seasonFolderId   = seasonFolderName;
    var seasonFolderList = self.cache.get('seriesSeasonFolderList' + self.user.id);

    if (!seasonFolderList) {
        self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    var series       = _.filter(seriesList, function(item) { return item.id === seriesId; })[0];
    var profile      = _.filter(profileList, function(item) { return item.profileId === profileId; })[0];
    var monitor      = _.filter(monitorList, function(item) { return item.type === monitorId; })[0];
    var type         = _.filter(typeList, function(item) { return item.type === typeId; })[0];
    var folder       = _.filter(folderList, function(item) { return item.folderId === folderId; })[0];
    var seasonFolder = _.filter(seasonFolderList, function(item) { return item.type === seasonFolderId; })[0];

    var postOpts              = {};
    postOpts.tvdbId           = series.tvdbId;
    postOpts.title            = series.title;
    postOpts.titleSlug        = series.titleSlug;
    postOpts.rootFolderPath   = folder.path;
    postOpts.seasonFolder     = (seasonFolder.type === i18n.__('globalYes') ? true : false);
    postOpts.monitored        = true;
    postOpts.seriesType       = (type.type === 'airs daily' ? 'daily' : type.type);
    postOpts.qualityProfileId = profile.profileId;
    postOpts.images           = [];

    var lastSeason  = _.max(series.seasons, 'seasonNumber');
    var firstSeason = _.min(_.reject(series.seasons, { seasonNumber: 0 }), 'seasonNumber');

    switch (monitor.type) {
    case 'future':
        postOpts.ignoreEpisodesWithFiles = true;
        postOpts.ignoreEpisodesWithoutFiles = true;
        break;
    case 'all':
        postOpts.ignoreEpisodesWithFiles = false;
        postOpts.ignoreEpisodesWithoutFiles = false;

        _.each(series.seasons, function(season) {
            if (season.seasonNumber !== 0) {
                season.monitored = true;
            } else {
                season.monitored = false;
            }
        });
        break;
    case 'none':
        _.each(series.seasons, function(season) {
            season.monitored = false;
        });
        break;
    case 'latest':
        _.each(series.seasons, function(season) {
            if (season.seasonNumber === lastSeason.seasonNumber) {
                season.monitored = true;
            } else {
                season.monitored = false;
            }
        });
        break;
    case 'first':
        _.each(series.seasons, function(season) {
            if (season.seasonNumber === firstSeason.seasonNumber) {
                season.monitored = true;
            } else {
                season.monitored = false;
            }
        });
        break;
    default:
        self._sendMessage(new Error(i18n.__('errorSonarrWentWrong')));
    }

    // update seasons to be monitored
    postOpts.seasons = series.seasons;

    logger.info(i18n.__('logSonarrSerieAddedWithOptions', self.username, series.title, JSON.stringify(postOpts)));

    self.sonarr.post('series', postOpts).then(function(result) {
        if (!result) {
            throw new Error(i18n.__('logSonarrSerieCantAdd'));
        }

        logger.info(i18n.__('logSonarrSerieAdded', self.username, series.title));

        if (self._isBotAdmin() && self.adminId !== self.user.id) {
            self.bot.sendMessage(self.user.id, i18n.__('botChatSonarrSerieAddedBy', series.title, self.username), {
                'selective': 2,
                'parse_mode': 'Markdown',
                'reply_markup': {
                    'hide_keyboard': true
                }
            });
        }

        return self.bot.sendMessage(self.user.id, i18n.__('botChatSonarrSerieAdded', series.title), {
            'selective': 2,
            'parse_mode': 'Markdown',
            'reply_markup': {
                'hide_keyboard': true
            }
        });
    })
        .catch(function(error) {
            return self._sendMessage(error);
        })
        .finally(function() {
            self._clearCache();
        });

};

/*
 * private methods
 */
SonarrMessage.prototype._sendMessage = function(message, keyboard) {
    var self = this;
    keyboard = keyboard || null;

    var options;
    if (message instanceof Error) {
        logger.warn(i18n.__('logMessageClear', self.username, message.message));

        message = message.message;
        options = {
            'parse_mode': 'Markdown',
            'reply_markup': {
                'hide_keyboard': true
            }
        };
    } else {
        options = {
            // 'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2,
            'reply_markup': JSON.stringify( { keyboard: keyboard, one_time_keyboard: true })
        };
    }
    //if we're in a chat, then send to the chat. 
    if ( self.chat && self.chat.id ){
        var mentionStr = '[' + self.user.first_name + ' ' + self.user.last_name + '](tg://user?id=' + (self.user.id) + ') \n';
        return self.bot.sendMessage(self.chat.id, (mentionStr) + message, options);
    }

    return self.bot.sendMessage(self.user.id, message, options);
};

SonarrMessage.prototype._isBotAdmin = function() {
    if (this.adminId === this.user.id) {
        return true;
    }
    return false;
};

SonarrMessage.prototype._clearCache = function() {
    var self = this;

    logger.info(i18n.__('logClearCache', self.username));

    var cacheItems = [
        'seriesId', 'seriesList', 'seriesProfileId',
        'seriesProfileList', 'seriesFolderId', 'seriesFolderList',
        'seriesMonitorId', 'seriesMonitorList', 'seriesFolderId',
        'seriesFolderList', 'seriesTypeId', 'seriesTypeList',
        'seriesSeasonFolderList', 'state'
    ];

    return _(cacheItems).forEach(function(item) {
        self.cache.del(item + self.user.id);
    });
};

module.exports = SonarrMessage;
