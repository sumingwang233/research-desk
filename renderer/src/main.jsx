import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { DeskProvider } from './store.jsx';
import { Shell } from './components/Shell.jsx';
import { ChatView } from './components/ChatView.jsx';
import { LibraryView } from './components/LibraryView.jsx';
import { NotesView } from './components/NotesView.jsx';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Navigate to="/chat" replace /> },
      { path: '/chat', element: <ChatView /> },
      { path: '/chat/:conversationId', element: <ChatView /> },
      { path: '/library', element: <LibraryView /> },
      { path: '/notes', element: <NotesView /> },
      { path: '*', element: <Navigate to="/chat" replace /> }
    ]
  }
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DeskProvider>
      <RouterProvider router={router} />
    </DeskProvider>
  </StrictMode>
);
