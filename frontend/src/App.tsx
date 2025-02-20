import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import Room from './components/Room';
import RoomList from './components/RoomList';

const router = createBrowserRouter([
  {
    path: "/",
    element: <RoomList />
  },
  {
    path: "/room/:roomId",
    element: <Room />
  }
]);

export default function App() {
  return <RouterProvider router={router} />;
}