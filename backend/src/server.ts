import app from "./app";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
	try {
		app.listen(PORT, () => {
			console.log(`Server running on port ${PORT}`);
		});
	} catch (error) {
		console.error('Failed to start server:', error);
		// Try alternative port
		app.listen(PORT, () => {
			console.log(`Server running on alternative port ${PORT}`);
		});
	}
};

startServer();
