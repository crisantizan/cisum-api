import mongoose, { model, Model } from 'mongoose';
import { User, UserCreate } from '@/modules/user/user.type';
const { Schema } = mongoose;

export interface UserDocument extends User, mongoose.Document {}

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    surname: { type: String, required: true },
    email: { type: String, required: true, unique: true, dropDups: true },
    password: { type: String, required: true },
    role: { type: String, required: true },
    image: { type: String, required: false },
  },
  { timestamps: true },
);

UserSchema.set('toJSON', { virtuals: true });

export default model<UserDocument>('User', UserSchema);
