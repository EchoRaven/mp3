var express = require('express');
var Task = require('../models/task');
var User = require('../models/user');

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
    var skipNum = req.query.skip ? parseInt(req.query.skip, 10) : NaN;
    if (!isNaN(skipNum)) query = query.skip(skipNum);
    var limitNum = req.query.limit ? parseInt(req.query.limit, 10) : 100; // default 100 for tasks
    if (!isNaN(limitNum)) query = query.limit(limitNum);
    return query;
}

module.exports = function(router) {
    var tasksRoute = router.route('/tasks');

    // GET /tasks with query params and count
    tasksRoute.get(async function(req, res) {
        try {
            if (req.query.count === 'true') {
                var countQuery = buildQuery(Task, req);
                var count = await countQuery.countDocuments();
                return res.status(200).json({ message: 'OK', data: count });
            }
            var query = buildQuery(Task, req);
            var tasks = await query.exec();
            res.status(200).json({ message: 'OK', data: tasks });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    // POST /tasks
    tasksRoute.post(async function(req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.deadline) {
                return res.status(400).json({ message: 'name and deadline are required', data: null });
            }
            var assignedUser = typeof body.assignedUser === 'string' ? body.assignedUser : '';
            var assignedUserName = typeof body.assignedUserName === 'string' ? body.assignedUserName : 'unassigned';

            // If assignedUser provided, verify user and set assignedUserName to user's name
            if (assignedUser) {
                var user = await User.findById(assignedUser).exec();
                if (!user) {
                    return res.status(400).json({ message: 'assignedUser not found', data: null });
                }
                assignedUserName = user.name;
            } else {
                assignedUserName = 'unassigned';
            }

            var task = new Task({
                name: body.name,
                description: body.description || '',
                deadline: new Date(body.deadline),
                completed: !!body.completed,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName
            });

            var saved = await task.save();

            // Two-way: if assigned, push to user's pendingTasks if not completed
            if (assignedUser && !saved.completed) {
                await User.updateOne({ _id: assignedUser }, { $addToSet: { pendingTasks: String(saved._id) } });
            }

            res.status(201).json({ message: 'Task created', data: saved });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    var taskByIdRoute = router.route('/tasks/:id');

    // GET /tasks/:id with optional select
    taskByIdRoute.get(async function(req, res) {
        try {
            var select = {};
            if (req.query.select) {
                try { select = JSON.parse(req.query.select); } catch (_) {}
            }
            var task = await Task.findById(req.params.id, select).exec();
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });
            res.status(200).json({ message: 'OK', data: task });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    // PUT /tasks/:id replace entire task
    taskByIdRoute.put(async function(req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.deadline) {
                return res.status(400).json({ message: 'name and deadline are required', data: null });
            }

            var task = await Task.findById(req.params.id).exec();
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });

            var prevAssignedUser = task.assignedUser;
            var prevCompleted = task.completed;

            // validate assignedUser
            var assignedUser = typeof body.assignedUser === 'string' ? body.assignedUser : '';
            var assignedUserName = 'unassigned';
            if (assignedUser) {
                var user = await User.findById(assignedUser).exec();
                if (!user) return res.status(400).json({ message: 'assignedUser not found', data: null });
                assignedUserName = user.name;
            }

            task.name = body.name;
            task.description = body.description || '';
            task.deadline = new Date(body.deadline);
            task.completed = !!body.completed;
            task.assignedUser = assignedUser;
            task.assignedUserName = assignedUserName;

            var saved = await task.save();

            // Two-way updates
            // Remove from previous user's pendingTasks if changed or completed
            if (prevAssignedUser && (prevAssignedUser !== assignedUser || saved.completed)) {
                await User.updateOne({ _id: prevAssignedUser }, { $pull: { pendingTasks: String(saved._id) } });
            }
            // Add to new user's pendingTasks if assigned and not completed
            if (assignedUser && !saved.completed) {
                await User.updateOne({ _id: assignedUser }, { $addToSet: { pendingTasks: String(saved._id) } });
            }

            res.status(200).json({ message: 'Task updated', data: saved });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    // DELETE /tasks/:id
    taskByIdRoute.delete(async function(req, res) {
        try {
            var task = await Task.findById(req.params.id).exec();
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });

            // Two-way: remove from assigned user's pendingTasks
            if (task.assignedUser) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } });
            }

            await task.deleteOne();
            res.status(200).json({ message: 'Task deleted', data: null });
        } catch (err) {
            res.status(500).json({ message: 'Server error', data: err.message });
        }
    });

    return router;
};


