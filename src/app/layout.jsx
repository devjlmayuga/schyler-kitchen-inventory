import './globals.css';

export const metadata = {
  title: 'Schyer's Kitchen',
  description: 'Takoyaki daily inventory and sales tracker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

