const HomeContent = require('../models/HomeContent');
const User = require('../models/User');
const { sendEmail, wrapHTML } = require('../config/email');
const { deleteFromCloudinary } = require('../utils/cloudinaryUtils');

const sendLaunchNotification = async (message, subtitle, emailMessage) => {
    try {
        const users = await User.find({}, 'email');
        const emails = users.map(u => u.email).filter(Boolean);
        if (!emails.length) return;

        await sendEmail({
            bcc: emails,
            subject: 'Looser Fit ya está disponible',
            html: wrapHTML(
                'Looser Fit está de nuevo en vivo',
                `<div style="font-size: 16px; line-height: 1.6; color: #333;">
                    <p>${emailMessage || message || 'La tienda está disponible nuevamente.'}</p>
                    ${subtitle ? `<p style="font-size: 15px; color: #555;">${subtitle}</p>` : ''}
                    <p>Ingresá ahora a ver los nuevos productos.</p>
                </div>`
            )
        });
        console.log(`✅ Notificación de lanzamiento enviada a ${emails.length} usuarios.`);
    } catch (err) {
        console.error('❌ [Email Error] tipo: Lanzamiento | error:', err.message);
    }
}

const getHomeContent = async (brandId) => {
    // Multi-marca: buscar el HomeContent de la marca activa
    let query = {};
    if (brandId) query.brand = brandId;

    let doc = await HomeContent.findOne(query).populate('featuredProducts');
    if (!doc) {
        // Crear un HomeContent vacío para esta marca si no existe
        doc = await HomeContent.create({
            brand: brandId,
            heroImages: []
        });
        doc = await HomeContent.findById(doc._id).populate('featuredProducts');
    }

    if (doc.comingSoon?.enabled && doc.comingSoon?.launchDate && new Date(doc.comingSoon.launchDate) <= new Date()) {
        doc.comingSoon.enabled = false;
        await doc.save();
        await sendLaunchNotification(doc.comingSoon.message, doc.comingSoon.subtitle, doc.comingSoon.emailMessage);
    }
    return doc;
};

const updateHero = async (brandId, images) => {
    // Ya no obligamos a que sean 3
    const home = await getHomeContent(brandId);
    const oldImages = home.heroImages || [];
    
    // Limpiar imágenes eliminadas
    const removed = oldImages.filter(img => !images.includes(img));
    for (const imgUrl of removed) {
        await deleteFromCloudinary(imgUrl);
    }

    home.heroImages = images;
    return await home.save();
};

const updateFamily = async (brandId, familyImages) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    
    const oldImages = doc.familyImages?.map(f => f.src) || [];
    const newUrls = familyImages.map(f => f.src);

    // Limpiar imágenes eliminadas
    const removed = oldImages.filter(img => !newUrls.includes(img));
    for (const imgUrl of removed) {
        await deleteFromCloudinary(imgUrl);
    }

    doc.familyImages = familyImages;
    return await doc.save();
};

const updateSettings = async (brandId, comingSoon) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    
    const enabled = Boolean(comingSoon.enabled);
    let launchDate = null;
    if (enabled) {
        const durationMinutes = Number(comingSoon.durationMinutes || 0);
        if (durationMinutes <= 0) throw new Error('La duración debe ser mayor a 0 minutos');
        launchDate = new Date(Date.now() + durationMinutes * 60000);
    }

    doc.comingSoon = {
        enabled,
        launchDate,
        message: comingSoon.message?.trim() || 'Web prendida próximamente en:',
        subtitle: comingSoon.subtitle?.trim() || '',
        emailMessage: comingSoon.emailMessage?.trim() || ''
    };

    return await doc.save();
};

const updateFeatured = async (brandId, productIds) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    const Product = require('../models/product');
    const validProducts = await Product.find({ _id: { $in: productIds }, brand: brandId }).distinct('_id');
    doc.featuredProducts = validProducts;
    await doc.save();
    return await doc.populate('featuredProducts');
};

module.exports = {
    getHomeContent,
    updateHero,
    updateFamily,
    updateSettings,
    updateFeatured
};
