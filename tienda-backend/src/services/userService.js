const User = require('../models/User');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const register = async (userData) => {
    const { nombre, email, password } = userData;

    // Verificar si ya existe
    let user = await User.findOne({ email });
    if (user) throw new Error('El email ya está registrado');

    // Crear nuevo usuario
    user = new User({ nombre, email, password });
    await user.save();

    // Generar token
    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const login = async (email, password) => {
    const user = await User.findOne({ email });
    if (!user) throw new Error('Credenciales inválidas');

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new Error('Credenciales inválidas');

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const getUserById = async (id) => {
    return await User.findById(id).select('-password');
};

const updateProfile = async (id, updateData) => {
    // Sanitizar campos permitidos para evitar escalación de privilegios (Mass Assignment)
    const allowedUpdates = {};
    if (updateData.nombre !== undefined) allowedUpdates.nombre = updateData.nombre;
    if (updateData.email !== undefined) allowedUpdates.email = updateData.email.toLowerCase().trim();

    return await User.findByIdAndUpdate(id, { $set: allowedUpdates }, { returnDocument: 'after' }).select('-password');
};

const registerFromOrder = async (data) => {
    const { email, password, nombre, orderId } = data;

    let user = await User.findOne({ email });
    if (user) throw new Error('Ya existe una cuenta con este email. Iniciá sesión para ver tu pedido.');

    // Crear usuario
    user = new User({ nombre, email, password });
    await user.save();

    // Vincular pedido
    if (orderId) {
        await Order.findByIdAndUpdate(orderId, { usuario: user._id });
    }

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });

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
