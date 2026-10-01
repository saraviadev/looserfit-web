const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

// Inicialización idempotente y segura
counterSchema.statics.initCounter = async function (counterId, initialSeq = 0) {
    return await this.findOneAndUpdate(
        { _id: counterId },
        { $setOnInsert: { seq: initialSeq } },
        { upsert: true, returnDocument: 'after' }
    );
};

// Generación estrictamente atómica mediante $inc en MongoDB
counterSchema.statics.getNextSequence = async function (counterId) {
    const counter = await this.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
    );
    return counter.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
