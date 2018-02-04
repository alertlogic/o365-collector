/* -----------------------------------------------------------------------------
 * @copyright (C) 2017, Alert Logic, Inc
 * @doc
 * 
 * The module for getting storage account settings.
 * 
 * @end
 * -----------------------------------------------------------------------------
 */

const async = require('async');
const util = require('util');
const moment = require('moment');
const parse = require('parse-key-value');

const m_alUtil = require('../lib/al_util');

var azureStorage = require('azure-storage');
var base64Encoder = new azureStorage.QueueMessageEncoder.TextBase64QueueMessageEncoder();
var QueueService = null;

var _getStateQueueName = function() {
    return 'alertlogic-o365-list';
};

var _getNewListState = function() {
    const selectedStreams = process.env.O365_CONTENT_STREAMS;
    var newState = [];
    const newCollectedTs = moment.utc().format();
    
    for (var i=0; i < selectedStreams.length; ++i) {
        var newStreamState = {
            streamName : selectedStreams[i],
            lastCollectedTs : newCollectedTs
        };
        newState.push(newStreamState);
    }
    
    return newState;
};

var _initQueueService = function() {
    const storageParams = parse(process.env.AzureWebJobsStorage);
    QueueService = azureStorage.createQueueService(
        storageParams.AccountName, 
        storageParams.AccountKey, 
        storageParams.AccountName + '.queue.core.windows.net');
    return QueueService;
};

var _getQueueService = function() {
    return (QueueService) ? QueueService : _initQueueService();
};

var _fetch = function(callback) {
    var queueService = _getQueueService();
    var options = {};
    const queueName = _getStateQueueName();
    
    options.visibilityTimeout = 180;
    
    queueService.getMessage(queueName, options,
        function(error, message) {
            if (error && error.code === 'QueueNotFound') {
                return callback(null, _getNewListState());
            } else if (!message) {
                // Another instance of a function is running.
                return callback(`Singleton protection $error`);
            } else {
                const decoded = base64Encoder.decode(message.messageText);
                var storedState = JSON.parse(decoded);
                return callback(null, storedState, message);
            }
    });
};

var _commit = function(message, callback) {
    var queueService = _getQueueService();
    if (message) {
        return queueService.deleteMessage(_getStateQueueName(),
            message.messageId, message.popReceipt, callback);
    } else {
        return callback(null);
    }
};

var _getCollectState = function(contentLists) {
    return contentLists.reduce(function(acc, currentStreamContent) {
        const contentLength = currentStreamContent.contentList.length;
        var lastTs = null;
        if (contentLength > 0) {
            const last = currentStreamContent.contentList[contentLength - 1];
            lastTs =  last.contentCreated;
        } else {
            lastTs = currentStreamContent.listTs;
        }
        
        var currentStatus = {
            streamName : currentStreamContent.streamName,
            lastCollectedTs : lastTs
        };
        acc.push(currentStatus);
        return acc;
    }, []);
};

// Generating stream specific list state for stored state.
// For example, from storedState
// [{
//  "streamName" : "Audit.General",
//  "lastCollectedTs":"2018-01-26T14:19:00.094Z"
// }]
// getting the following list for "Audit.General":
// {
//  "streamName" : "Audit.General",
//  "listStartTs":"2018-01-26T14:19:00.095Z",
//  "listEndTs":"2018-01-26T14:24:00"
// }
//
var _getStreamListState = function(stream, storedState) {
    var streamStoredState = storedState.find(obj => obj.streamName === stream);
    var listState = null; 
    
    if (streamStoredState) {
        listState = {
            streamName : stream,
            listStartTs : moment.utc(streamStoredState.lastCollectedTs).add(1, 'milliseconds').toISOString()
        };
    } else {
        listState = {
            streamName : stream,
            listStartTs : moment.utc().format()
        };
    }
    return listState;
};


module.exports = {
    getQueueService : _getQueueService,
    getStreamListState : _getStreamListState,
    getCollectState : _getCollectState,
    fetch : _fetch,
    commit : _commit
};