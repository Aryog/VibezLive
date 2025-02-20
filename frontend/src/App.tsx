import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import Room from './components/Room';

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
          <h1 className="text-3xl font-bold mb-4">VibezLive</h1>
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Create New Room</h2>
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                const roomId = new FormData(e.currentTarget).get('roomId');
                if (roomId) {
                  try {
                    const response = await fetch('http://localhost:5000/api/rooms/create', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ roomId }),
                    });
                    
                    if (response.ok) {
                      window.location.href = `/room/${roomId}`;
                    }
                  } catch (error) {
                    console.error('Error creating room:', error);
                  }
                }
              }}
              className="space-y-4"
            >
              <input
                type="text"
                name="roomId"
                placeholder="Enter Room ID"
                className="w-full px-4 py-2 border rounded-lg"
                required
              />
              <button
                type="submit"
                className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Create Room
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  },
  {
    path: "/room/:roomId",
    element: <Room />
  }
]);

export default function App() {
  return <RouterProvider router={router} />;
}