var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');

function buildQuery(model, req) {
    var query = model.find();
    if (req.query.where) {
        try { query = query.find(JSON.parse(req.query.where)); } catch (_) {}
    }
    if (req.query.sort) {
        try { query = query.sort(JSON.parse(req.query.sort)); } catch (_) {}
    }
    if (req.query.select) {
        try { query = query.select(JSON.parse(req.query.select)); } catch (_) {}
    }
    if (req.query.skip) {
        var skipNum = parseInt(req.query.skip, 10);
        if (!isNaN(skipNum)) query = query.skip(skipNum);
    }
    if (req.query.limit) {
        var limitNum = parseInt(req.query.limit, 10);
        if (!isNaN(limitNum)) query = query.limit(limitNum);
    }
    return query;
}

module.exports = function(router) {
    var usersRoute = router.route('/users');

    // GET /users with query params and count
    usersRoute.get(async function(req, res) {
        try {
            if (req.query.count === 'true') {
                var countQuery = buildQuery(User, req);
                var count = await countQuery.countDocuments();
                return res.status(200).json({ message: 'OK', data: count });
            }
            var query = buildQuery(User, req);
            var users = await query.exec();
            res.status(200).json({ message: 'OK', data: users });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    // POST /users
    usersRoute.post(async function(req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.email) {
                return res.status(400).json({ message: 'name and email are required', data: null });
            }
            var user = new User({
                name: body.name,
                email: body.email,
                pendingTasks: Array.isArray(body.pendingTasks) ? body.pendingTasks : []
            });
            var saved = await user.save();
            res.status(201).json({ message: 'User created', data: saved });
        } catch (err) {
            var code = err && err.code === 11000 ? 400 : 500; // duplicate email
            var msg = err && err.code === 11000 ? 'email must be unique' : 'Server error';
            res.status(code).json({ message: msg, data: err.message });
        }
    });

    var userByIdRoute = router.route('/users/:id');

    // GET /users/:id with optional select
    userByIdRoute.get(async function(req, res) {
        try {
            var select = {};
            if (req.query.select) {
                try { select = JSON.parse(req.query.select); } catch (_) {}
            }
            var user = await User.findById(req.params.id, select).exec();
            if (!user) return res.status(404).json({ message: 'User not found', data: null });
            res.status(200).json({ message: 'OK', data: user });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    // PUT /users/:id replace entire user
    userByIdRoute.put(async function(req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.email) {
                return res.status(400).json({ message: 'name and email are required', data: null });
            }
            var existing = await User.findById(req.params.id).exec();
            if (!existing) return res.status(404).json({ message: 'User not found', data: null });

            existing.name = body.name;
            existing.email = body.email;
            existing.pendingTasks = Array.isArray(body.pendingTasks) ? body.pendingTasks : [];

            var saved = await existing.save();

            // Two-way reference: ensure tasks in pendingTasks are assigned to this user
            await Task.updateMany(
                { _id: { $in: saved.pendingTasks } },
                { $set: { assignedUser: String(saved._id), assignedUserName: saved.name } }
            );
            // Unassign tasks not in pendingTasks that were previously assigned to this user
            await Task.updateMany(
                { assignedUser: String(saved._id), _id: { $nin: saved.pendingTasks } },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
            );

            res.status(200).json({ message: 'User updated', data: saved });
        } catch (err) {
            var code = err && err.code === 11000 ? 400 : 500;
            var msg = err && err.code === 11000 ? 'email must be unique' : 'Server error';
            res.status(code).json({ message: msg, data: err.message });
        }
    });

    // DELETE /users/:id
    userByIdRoute.delete(async function(req, res) {
        try {
            var user = await User.findById(req.params.id).exec();
            if (!user) return res.status(404).json({ message: 'User not found', data: null });

            // Two-way reference: unassign the user's pending tasks
            await Task.updateMany(
                { _id: { $in: user.pendingTasks } },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
            );

            await user.deleteOne();
            res.status(200).json({ message: 'User deleted', data: null });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    return router;
};


