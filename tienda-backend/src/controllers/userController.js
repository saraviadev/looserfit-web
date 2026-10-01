const userService = require('../services/userService');

const register = async (req, res) => {
    try {
        const result = await userService.register(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await userService.login(email, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
};

const getProfile = async (req, res) => {
    try {
        const user = await userService.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (_e) {
        res.status(500).json({ error: 'Error al obtener perfil' });
    }
};

const updateProfile = async (req, res) => {
    try {
        const user = await userService.updateProfile(req.user.id, req.body);
        res.json(user);
    } catch (_e) {
        res.status(400).json({ error: 'Error al actualizar perfil' });
    }
};

const registerFromOrder = async (req, res) => {
    try {
        const result = await userService.registerFromOrder(req.body);
        res.status(201).json(result);
    } catch (error) {
        const statusCode = error.statusCode || 400;
        res.status(statusCode).json({ error: error.message });
    }
};

module.exports = {
    register,
    login,
    getProfile,
    updateProfile,
    registerFromOrder
};
