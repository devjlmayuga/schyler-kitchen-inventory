import './globals.css';

export const metadata = {
  title: 'Schyer Kitchen',
  description: 'Takoyaki daily inventory and sales tracker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

