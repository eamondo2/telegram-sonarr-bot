/* global __dirname */

'use strict';

var fs          = require('fs');                        // https://nodejs.org/api/fs.html
var _           = require('lodash');                    // https://www.npmjs.com/package/lodash
var NodeCache   = require('node-cache');                // https://www.npmjs.com/package/node-cache
var TelegramBot = require('node-telegram-bot-api');     // https://www.npmjs.com/package/node-telegram-bot-api

/*
 * libs
 */
var i18n   = require(__dirname + '/lib/lang');          // set up multilingual support
var config = require(__dirname + '/lib/config');        // the concised configuration
var state  = require(__dirname + '/lib/state');         // handles command structure
var logger = require(__dirname + '/lib/logger');        // logs to file and console
var acl    = require(__dirname + '/lib/acl');           // set up the acl file

/*
 * modules
 */
var SonarrMessage = require(__dirname + '/modules/SonarrMessage');

/*
 * modules
 */
i18n.setLocale(config.bot.lang);

/*
 * set up the telegram bot
 */
var bot = new TelegramBot(config.telegram.botToken, { polling: true });

/*
 * set up a simple caching tool
 */
var cache = new NodeCache({ stdTTL: 120, checkperiod: 150 });

/*
 * Save bots name, for parsing in group @ commands
 */

var botName = '';
var botUname = '';

/*
 * get the bot name
 */
bot.getMe().then(function(msg) {
    logger.info(i18n.__('logBotInitialisation'), msg.username);
    botName = msg.first_name;
    botUname = msg.username;
})
    .catch(function(err) {
        throw new Error(err);
    });

/*
Send at a specific user in a chat
*/
function sendAtUser(chatID, user, message){
    
    var mentionStr = '[' + user.first_name + ' ' + user.last_name + '](tg://user?id=' + (user.id) + ') \n';

    return bot.sendMessage(chatID, (mentionStr) + message.join('\n'), { 'parse_mode': 'Markdown'});

}


function echoCmd(msg, match) {

    var fromId = msg.chat.id;
    var resp = [];

    resp.push(match);
  
    return sendAtUser(msg.chat.id, msg.from, resp);
}

/*
* handle start command
*/
function startCmd(msg) {
    var fromId = msg.from.id;

    verifyUser(fromId);

    logger.info(i18n.__('logUserStartCommand'), fromId);
    sendCommands(fromId, msg);
}

/*
* handle help command
*/
function helpCmd(msg) {
    var fromId = msg.from.id;

    verifyUser(fromId);

    logger.info(i18n.__('logUserHelpCommand', fromId));
    sendCommands(fromId, msg);
}

/*
* handle authorization
*/
function authCmd(msg, match) {
    var fromChat = msg.chat.id;
    var fromUser = msg.from.id;
    var password = match;

    var message = [];

    if (isAuthorized(fromUser)) {
        message.push(i18n.__('botChatAuthAlreadyAuthorized_1'));
        message.push(i18n.__('botChatAuthAlreadyAuthorized_2'));
        return bot.sendMessage(fromUser,  message.join('\n'));
    }

    // make sure the user is not banned
    if (isRevoked(fromUser)) {
        message.push(i18n.__('botChatAuthIsRevoked_1'));
        message.push(i18n.__('botChatAuthIsRevoked_2'));
        return bot.sendMessage(fromChat, message.join('\n'));
    }

    if (password !== config.bot.password) {
        return replyWithError(fromChat, new Error(i18n.__('errorInvalidPassowrd')));
    }

    acl.allowedUsers.push(msg.from);
    updateACL();

    if (acl.allowedUsers.length === 1) {
        promptOwnerConfig(fromChat);
    }

    if (config.bot.owner) {
        bot.sendMessage(config.bot.owner, i18n.__('botChatAuthUserWasGranted', getTelegramName(msg.from)));
    }

    message.push(i18n.__('botChatAuthGranted_1'));
    message.push(i18n.__('botChatAuthGranted_2'));

    bot.sendMessage(fromChat, message.join('\n'));
}

/*
* handle users
*/
function usersCmd(msg){
    var fromId = msg.from.id;

    verifyAdmin(fromId);
    if(isAdmin(fromId)){

        var response = [i18n.__('botChatUsers')];
        _.forEach(acl.allowedUsers, function(n, key) {
            response.push('➸ ' + getTelegramName(n));
        });

        return bot.sendMessage(fromId, response.join('\n'));

    } 

}

/*
* handle user access revocation
*/
function revokeCmd(msg) {
    var fromId = msg.from.id;

    verifyAdmin(fromId);
    if(isAdmin(fromId)){
        var opts = {};

        if (!acl.allowedUsers.length) {
            var message = 'There aren\'t any allowed users.';

            opts = {
                'disable_web_page_preview': true,
                'parse_mode': 'Markdown',
                'selective': 2,
            };

            return bot.sendMessage(fromId, message, opts);
        }

        var keyboardList = [], keyboardRow = [], revokeList = [];
        var response = ['*Allowed Users:*'];
        _.forEach(acl.allowedUsers, function(n, key) {
            revokeList.push({
                'id': key + 1,
                'userId': n.id,
                'keyboardValue': getTelegramName(n)
            });
            response.push('➸ ' + getTelegramName(n));

            keyboardRow.push(getTelegramName(n));
            if (keyboardRow.length === 2) {
                keyboardList.push(keyboardRow);
                keyboardRow = [];
            }
        });

        response.push(i18n.__('selectFromMenu'));


        if (keyboardRow.length === 1) {
            keyboardList.push([keyboardRow[0]]);
        }

        // set cache
        cache.set('state' + fromId, state.admin.REVOKE);
        cache.set('revokeUserList' + fromId, revokeList);
  
        var message = response.join('\n');
  
        return bot.sendMessage(fromId, message, {
            'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2,
            'reply_markup': JSON.stringify({ keyboard: keyboardList, one_time_keyboard: true }),
        });
    }
}

/*
* handle user access unrevocation
*/
function unrevokeCmd(msg){
    var fromId = msg.from.id;

    verifyAdmin(fromId);
    if(isAdmin(fromId)){
        var opts = {};

        if (!acl.revokedUsers.length) {
            var message = 'There aren\'t any revoked users.';

            return bot.sendMessage(fromId, message, {
                'disable_web_page_preview': true,
                'parse_mode': 'Markdown',
                'selective': 2,
            });
        }

        var keyboardList = [], keyboardRow = [], revokeList = [];
        var response = ['*Revoked Users:*'];
        _.forEach(acl.revokedUsers, function(n, key) {
            revokeList.push({
                'id': key + 1,
                'userId': n.id,
                'keyboardValue': getTelegramName(n)
            });

            response.push('➸ ' + getTelegramName(n));

            keyboardRow.push(getTelegramName(n));
            if (keyboardRow.length == 2) {
                keyboardList.push(keyboardRow);
                keyboardRow = [];
            }
        });

        response.push(i18n.__('selectFromMenu'));

        if (keyboardRow.length === 1) {
            keyboardList.push([keyboardRow[0]]);
        }

        // set cache
        cache.set('state' + fromId, state.admin.UNREVOKE);
        cache.set('unrevokeUserList' + fromId, revokeList);

        return bot.sendMessage(fromId, response.join('\n'), {
            'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2,
            'reply_markup': JSON.stringify({ keyboard: keyboardList, one_time_keyboard: true })
        });
    }
}

/*
* handle clear command
*/
function clearCmd(msg) {
    var fromId = msg.from.id;

    if(isAuthorized(fromId)){
        logger.info('user: %s, message: sent \'/clear\' command', fromId);
        clearCache(fromId);
        logger.info('user: %s, message: \'/clear\' command successfully executed', fromId);

        return bot.sendMessage(fromId, 'All previously sent commands have been cleared, yey!', {
            'reply_markup': {
                'hide_keyboard': true
            }
        });
    } else {
        return replyWithError(fromId, new Error(i18n.__('notAuthorized')));
    }
}
/*
 * handle sonarr commands
 */
bot.on('message', function(msg) {
/** 
     * 
     * Always first step function
     * 
    */

    var user    = msg.from;
    var chat    = msg.chat? msg.chat:null;
    var message = msg.text;

   
    if ( /^\/(\S+)\s?(@)(\S+)\s?(.+)?$/g.test(msg.text)){
        var nameMatch = /^\/(\S+)\s?(@)(\S+)\s?(.+)?$/g.exec(msg.text)[3] || null;
        if ( nameMatch != botName && nameMatch != botUname ){
            
            return null;
        } 
    } else if  (!cache.get('state' + user.id)) {
        return null;
    } 
    /*
 Fixing escape-less nonsense
 */
 
    if (/^\/auth\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        var text = /^\/auth\s?(@)(\S+)\s?(.+)?$/g.exec(message) [3] || null;
        return (authCmd(msg, text));

    }

    if (/^\/echo\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        var text = /^\/echo\s?(@)(\S+)\s?(.+)?$/g.exec(message) [3] || null;
        return (echoCmd(msg, text));
    }

    if (/^\/clear\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (clearCmd(msg));
    }

    if (/^\/unrevoke\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (unrevokeCmd(msg));
    }

    if (/^\/revoke\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (revokeCmd(msg));
    }

    if (/^\/users\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (usersCmd(msg));
    }

    if (/^\/help\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (helpCmd(msg));
    }

    if (/^\/start\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        return (startCmd(msg));
    }


    var sonarr = new SonarrMessage(bot, user, chat, cache);

    if (/^\/library\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        if(isAuthorized(user.id)){
            var searchText = /^\/library\s?(@)(\S+)\s?(.+)?$/g.exec(message)[3] || null;
            return sonarr.performLibrarySearch(searchText);
        } else {
            return replyWithError(user.id, new Error(i18n.__('notAuthorized')));
        }
    }

    if(/^\/disk\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        if(isAuthorized(user.id)){
            return sonarr.getDiskUsage();
        } else {
            return replyWithError(user.id, new Error(i18n.__('notAuthorized')));
        }
    }

    if(/^\/rss\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        verifyAdmin(user.id);
        if(isAdmin(user.id)){
            return sonarr.performRssSync();
        }  
    }

    if(/^\/wanted\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        verifyAdmin(user.id);
        if(isAdmin(user.id)){
            return sonarr.performWantedSearch();
        }
    }

    if(/^\/refresh\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        verifyAdmin(user.id);
        if(isAdmin(user.id)){
            return sonarr.performLibraryRefresh();
        }
    }

    if (/^\/upcoming\s?(@)(\S+)\s?(\d+)?$/g.test(message)) {
        if(isAuthorized(user.id)){
            var futureDays = /^\/upcoming\s?(@)(\S+)\s?(\d+)?$/g.exec(message)[3] || 3;
            return sonarr.performCalendarSearch(futureDays);
        } else {
            return replyWithError(user.id, new Error(i18n.__('notAuthorized')));
        }
    }

    /*
   * /cid command
   * Gets the current chat id
   * Used for configuring notifications and similar tasks
   */
    if (/^\/cid\s?(@)(\S+)$/g.test(message)) {
        verifyAdmin(user.id);
        logger.info(i18n.__('logUserCidCommand', user.id, msg.chat.id));
        return bot.sendMessage(msg.chat.id, i18n.__('botChatCid', msg.chat.id));
    }


    /*
   * /query command
   */
    if (/^\/([Qq](uery)?)\s?(@)(\S+)\s?(.+)?$/g.test(message)) {
        if(isAuthorized(user.id)){
            var movieName = /^\/[Qq](uery)?\s?(@)(\S+)\s?(.+)?$/g.exec(message)[4] || null;
            return sonarr.sendMoviesList(movieName);
        } else {
            return replyWithError(user.id, new Error(i18n.__('notAuthorized')));     
        }
    }


    // get the current cache state
    var currentState = cache.get('state' + user.id);

    if (currentState === state.admin.REVOKE) {
        verifyUser(user.id);
        return handleRevokeUser(user.id, message);
    }

    if (currentState === state.admin.REVOKE_CONFIRM) {
        verifyUser(user.id);
        return handleRevokeUserConfirm(user.id, message);
    }

    if (currentState === state.admin.UNREVOKE) {
        verifyUser(user.id);
        return handleUnRevokeUser(user.id, message);
    }

    if (currentState === state.admin.UNREVOKE_CONFIRM) {
        verifyUser(user.id);
        return handleUnRevokeUserConfirm(user.id, message);
    }

    if (currentState === state.sonarr.CONFIRM) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQuerySeriesConfirm', user.id, message));
        return sonarr.confirmShowSelect(message);
    }

    if (currentState === state.sonarr.PROFILE) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQuerySeriesChoose', user.id, message));
        return sonarr.sendProfileList(message);
    }

    if (currentState === state.sonarr.MONITOR) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQueryProfileChoose', user.id, message));
        return sonarr.sendMonitorList(message);
    }

    if (currentState === state.sonarr.TYPE) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQueryTypeChoose', user.id, message));
        return sonarr.sendTypeList(message);
    }

    if (currentState === state.sonarr.FOLDER) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQueryFolderChoose', user.id, message));
        return sonarr.sendFolderList(message);
    }

    if (currentState === state.sonarr.SEASON_FOLDER) {
        verifyUser(user.id);
        logger.info(i18n.__('botChatQuerySeasonFolderChoose', user.id, message));
        return sonarr.sendSeasonFolderList(message);
    }

    if (currentState === state.sonarr.ADD_SERIES) {
        verifyUser(user.id);
        return sonarr.sendAddSeries(message);
    }

});


/*
 * @TODO  AdminMessage module ?
 * revoke user
 */
function handleRevokeUser(userId, revokedUser) {

    logger.info(i18n.__('logRevokeUserSelected',userId, revokedUser));

    var keyboardList = [];
    var response = [i18n.__('botChatRevokeConfirmation', revokedUser)];
    keyboardList.push([i18n.__('globalNo')]);
    keyboardList.push([i18n.__('globalYes')]);

    // set cache
    cache.set('state' + userId, state.admin.REVOKE_CONFIRM);
    cache.set('revokedUserName' + userId, revokedUser);

    return bot.sendMessage(userId, response.join('\n'), {
        'disable_web_page_preview': true,
        'parse_mode': 'Markdown',
        'selective': 2,
        'reply_markup': JSON.stringify({ keyboard: keyboardList, one_time_keyboard: true })
    });
}

/*
 * confirm revoked user
 */
function handleRevokeUserConfirm(userId, revokedConfirm) {

    logger.info(i18n.__('logRevokeConfirmationSelected',userId, revokedConfirm));

    var revokedUser = cache.get('revokedUserName' + userId);
    var opts = {};
    var message = '';

    if (revokedConfirm === i18n.__('globalNo')) {
        clearCache(userId);
        message = i18n.__('botChatRevokeFailed',revokedUser);
        return bot.sendMessage(userId, message, {
            'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2
        });
    }

    var revokedUserList = cache.get('revokeUserList' + userId);
    var i = revokedUserList.map(function(e) { return e.keyboardValue; }).indexOf(revokedUser);
    var revokedUserObj = revokedUserList[i];
    var j = acl.allowedUsers.map(function(e) { return e.id; }).indexOf(revokedUserObj.userId);

    acl.revokedUsers.push(acl.allowedUsers[j]);
    acl.allowedUsers.splice(j, 1);
    updateACL();

    message = i18n.__('botChatRevokeSuccess',revokedUser);

    return bot.sendMessage(userId, message, {
        'disable_web_page_preview': true,
        'parse_mode': 'Markdown',
        'selective': 2
    });
}

/*
 * unrevoke user
 */
function handleUnRevokeUser(userId, revokedUser) {

    logger.info(i18n.__('logUnrevokeUserSelected',userId, revokedUser));

    var keyboardList = [];
    var response = [i18n.__('botChatUnrevokeConfirmation', revokedUser)];
    keyboardList.push([i18n.__('globalNo')]);
    keyboardList.push([i18n.__('globalYes')]);
  
    // set cache
    cache.set('state' + userId, state.admin.UNREVOKE_CONFIRM);
    cache.set('revokedUserName' + userId, revokedUser);

    var keyboard = {
        keyboard: keyboardList,
        one_time_keyboard: true
    };

    return bot.sendMessage(userId, response.join('\n'), {
        'disable_web_page_preview': true,
        'parse_mode': 'Markdown',
        'selective': 2,
        'reply_markup': JSON.stringify({keyboard: keyboardList, one_time_keyboard: true })
    });
}

/*
 * confirm unrevoked user
 */
function handleUnRevokeUserConfirm(userId, revokedConfirm) {

    logger.info(i18n.__('logUnrevokeConfirmationSelected',userId, revokedConfirm));

    var revokedUser = cache.get('revokedUserName' + userId);
    var opts = {};
    var message = '';
    if (revokedConfirm === i18n.__('globalNo')) {
        clearCache(userId);
        message = i18n.__('botChatRevokeFailed',revokedUser);
        return bot.sendMessage(userId, message, {
            'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2
        });
    }

    var unrevokedUserList = cache.get('unrevokeUserList' + userId);
    var i = unrevokedUserList.map(function(e) { return e.keyboardValue; }).indexOf(revokedUser);
    var unrevokedUserObj = unrevokedUserList[i];
    var j = acl.revokedUsers.map(function(e) { return e.id; }).indexOf(unrevokedUserObj.userId);
    acl.revokedUsers.splice(j, 1);
    updateACL();

    message = i18n.__('botChatRevokeSuccess',revokedUser);

    return bot.sendMessage(userId, message, {
        'disable_web_page_preview': true,
        'parse_mode': 'Markdown',
        'selective': 2
    });
}

/*
 * save access control list
 */
function updateACL() {
    fs.writeFile(__dirname + '/acl.json', JSON.stringify(acl), function(err) {
        if (err) {
            throw new Error(err);
        }

        logger.info(i18n.__('logAclUpdated'));
    });
}

/*
 * verify user can use the bot
 */
function verifyUser(userId) {
    if (_.some(acl.allowedUsers, { 'id': userId }) !== true) {
        return replyWithError(userId, new Error(i18n.__('notAuthorized')));
    }
}

/*
 * verify admin of the bot
 */
function verifyAdmin(userId) {
    if (isAuthorized(userId)) {
        promptOwnerConfig(userId);
    }

    if (config.bot.owner !== userId) {
        return replyWithError(userId, new Error(i18n.__('adminOnly')));
    }
}

/*
 * is this userId a admin?
 */
function isAdmin(userId) {
    if (config.bot.owner === userId) {
        return true;
    }
    return false;
}

/*
 * check to see is user is authenticated
 * returns true/false
 */
function isAuthorized(userId) {
    return _.some(acl.allowedUsers, { 'id': userId });
}

/*
 * check to see is user is banned
 * returns true/false
 */
function isRevoked(userId) {
    return _.some(acl.revokedUsers, { 'id': userId });
}

/*
 * prompt for admin message
 */
function promptOwnerConfig(userId) {
    if (!config.bot.owner) {
        var message = [i18n.__('botChatWarningOwner_1', userId)];
        message.push(i18n.__('botChatWarningOwner_2'));
        message.push(i18n.__('botChatWarningOwner_3'));
        return bot.sendMessage(userId, message.join('\n'));
    }
}

/*
 * handle removing the custom keyboard
 */
function replyWithError(userId, err) {
    logger.warn(i18n.__('logWarnError', userId, err.message));
    return bot.sendMessage(userId, i18n.__('botChatErrorFormat', err), {
        'parse_mode': 'Markdown',
        'reply_markup': {
            'hide_keyboard': true
        }
    });
}

/*
 * clear caches
 */
function clearCache(userId) {
    var cacheItems = [
        'seriesId', 'seriesList', 'seriesProfileId',
        'seriesProfileList', 'seriesFolderId', 'seriesFolderList',
        'seriesMonitorId', 'seriesMonitorList', 'seriesFolderId',
        'seriesFolderList', 'seriesTypeId', 'seriesTypeList',
        'seriesSeasonFolderList',
        'revokedUserName', 'revokeUserList',
        'state'
    ];

    _(cacheItems).forEach(function(item) {
        cache.del(item + userId);
    });
}

/*
 * get telegram name
 */
function getTelegramName(user) {
    var lastname = '';
    if (typeof user === 'object') {
        lastname = (user.last_name !== undefined) ? ' ' + user.last_name : '';
        return user.username || (user.first_name + lastname);
    }
    if (typeof user === 'number') {
        var aclUser = _.filter(acl.allowedUsers, function(item) { return item.id === user; })[0];
        lastname = (aclUser.last_name !== undefined) ? ' ' + aclUser.last_name : '';
        return aclUser.username || (aclUser.first_name + lastname);
    }
    return i18n.__('globalUnknowUser');
}

/*
 * Send Commands To chat
 */
function sendCommands(fromId, msg) {
    var response = ['Hello ' + getTelegramName(fromId) + '!'];
    response.push(i18n.__('botChatHelp_1'));
    response.push(i18n.__('botChatHelp_2'));
    response.push(i18n.__('botChatHelp_3'));
    response.push(i18n.__('botChatHelp_4'));
    response.push(i18n.__('botChatHelp_5'));
    response.push(i18n.__('botChatHelp_6'));
    response.push(i18n.__('botChatHelp_7'));
    response.push(i18n.__('botChatHelp_8'));

    if (isAdmin(fromId)) {
        response.push(i18n.__('botChatHelp_9'));
        response.push(i18n.__('botChatHelp_10'));
        response.push(i18n.__('botChatHelp_11'));
        response.push(i18n.__('botChatHelp_12'));
        response.push(i18n.__('botChatHelp_13'));
        response.push(i18n.__('botChatHelp_14'));
        response.push(i18n.__('botChatHelp_15'));
    }

    //return bot.sendMessage(fromId, response.join('\n'), { 'parse_mode': 'Markdown', 'selective': 2 });
    return bot.sendMessage(msg.chat.id?msg.chat.id:fromId, response.join('\n'));
}
