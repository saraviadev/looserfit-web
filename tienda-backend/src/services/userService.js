const User = require('../models/User');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');

const getJwtSecret = () => process.env.JWT_SECRET || 'looserfit_jwt_secret_fallback_key';

const register = async (userData) => {
    const { nombre, email, password } = userData;

    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
        throw new Error('El usuario ya existe');
    }

    user = new User({ nombre: nombre?.trim(), email: normalizedEmail, password });
    await user.save();

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const login = async (email, password) => {
    const normalizedEmail = email ? email.toLowerCase().trim() : '';
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        throw new Error('Credenciales inválidas');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        throw new Error('Credenciales inválidas');
    }

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const getUserById = async (id) => {
    return await User.findById(id).select('-password');
};

const updateProfile = async (id, updateData) => {
    const allowedUpdates = {};
    if (updateData.nombre !== undefined) allowedUpdates.nombre = updateData.nombre.trim();
    if (updateData.email !== undefined) allowedUpdates.email = updateData.email.toLowerCase().trim();

    return await User.findByIdAndUpdate(id, { $set: allowedUpdates }, { returnDocument: 'after' }).select('-password');
};

// SEC-02: Registro desde pedido con estricta validación de coincidencia de emails y ownership
const registerFromOrder = async (data) => {
    const { email, password, nombre, orderId } = data || {};

    if (!orderId) {
        const error = new Error('Se requiere el ID del pedido');
        error.statusCode = 400;
        throw error;
    }

    const regEmail = email ? email.trim().toLowerCase() : '';
    if (!regEmail) {
        const error = new Error('El email es requerido');
        error.statusCode = 400;
        throw error;
    }

    let existingUser = await User.findOne({ email: regEmail });
    if (existingUser) {
        const error = new Error('Ya existe una cuenta con este email. Iniciá sesión para ver tu pedido.');
        error.statusCode = 400;
        throw error;
    }

    const order = await Order.findById(orderId);
    if (!order) {
        const error = new Error('Pedido no encontrado');
        error.statusCode = 404;
        throw error;
    }

    if (order.usuario) {
        const error = new Error('El pedido ya se encuentra asociado a una cuenta');
        error.statusCode = 409;
        throw error;
    }

        const orderEmail = order.datosEnvio?.email ? order.datosEnvio.email.trim().toLowerCase() : '';
    if (!orderEmail) {
        const error = new Error('El pedido no tiene un email de contacto válido');
        error.statusCode = 400;
        throw error;
    }

    if (regEmail !== orderEmail) {
        const error = new Error('El email de registro no coincide con el email del pedido');
        error.statusCode = 403;
        throw error;
    }

    // SEC-02 Hardening: Si se provee guestToken, validar correspondencia con la orden
    const providedGuestToken = data.guestToken || data.trackingToken;
    if (providedGuestToken && order.trackingToken && providedGuestToken !== order.trackingToken) {
        const error = new Error('Token de invitado no válido para asociar este pedido.');
        error.statusCode = 403;
        throw error;
    }

    // Crear usuario
    const user = new User({ nombre: nombre?.trim(), email: regEmail, password });
    await user.save();

    // Vincular pedido de manera segura
    order.usuario = user._id;
    await order.save();

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

module.exports = {
    register,
    login,
    getUserById,
    updateProfile,
    registerFromOrder
};
