import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
	username: string;
	email: string;
	password: string;
	displayName?: string;
	profilePicture?: string;
	isVerified: boolean;
	joinedAt: Date;
	lastLogin?: Date;
	comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema: Schema = new Schema(
	{
		username: { type: String, required: true, unique: true, trim: true },
		email: { type: String, required: true, unique: true, trim: true, lowercase: true },
		password: { type: String, required: true },
		displayName: { type: String, trim: true },
		profilePicture: { type: String },
		isVerified: { type: Boolean, default: false },
		lastLogin: { type: Date },
	},
	{ timestamps: { createdAt: 'joinedAt', updatedAt: 'updatedAt' } }
);

// Hash password before saving
UserSchema.pre<IUser>('save', async function(next) {
	if (!this.isModified('password')) return next();

	try {
		const salt = await bcrypt.genSalt(10);
		this.password = await bcrypt.hash(this.password, salt);
		next();
	} catch (error) {
		next(error as Error);
	}
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
	return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);
