/*
 * Connect all of your endpoints together here.
 */
var express = require('express');

module.exports = function (app, _router) {
    app.use('/api', require('./home.js')(express.Router()));
    app.use('/api', require('./users.js')(express.Router()));
    app.use('/api', require('./tasks.js')(express.Router()));
};
