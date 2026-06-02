import './globals.css';

export const metadata = {
  title: 'Takoyaki Ops',
  description: 'Takoyaki daily inventory and sales tracker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

