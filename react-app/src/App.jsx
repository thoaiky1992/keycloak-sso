import React, { useEffect, useState } from 'react';
import keycloak from './keycloak.js';

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(keycloak.authenticated));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authenticated) return undefined;

    // Tokens stay in keycloak-js memory; refresh before they expire.
    const timer = window.setInterval(async () => {
      try {
        await keycloak.updateToken(30);
      } catch (cause) {
        console.error('Token refresh failed', cause);
        setAuthenticated(false);
        setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [authenticated]);

  const login = () => keycloak.login({ redirectUri: window.location.origin + '/' });
  const logout = () => keycloak.logout({ redirectUri: window.location.origin + '/' });
  console.log(keycloak.tokenParsed)
  const name = keycloak.tokenParsed?.preferred_username ?? 'người dùng';

  return (
    <main className="card">
      <span className="eyebrow">Keycloak SSO Demo</span>
      <h1>{import.meta.env.VITE_APP_NAME}</h1>
      {error && <p role="alert" className="error">{error}</p>}
      {authenticated ? (
        <>
          <p>Xin chào, <strong>{name}</strong>. Bạn đã đăng nhập thành công.</p>
          <p className="hint">Mở ứng dụng còn lại để kiểm tra phiên đăng nhập SSO.</p>
          <button type="button" onClick={logout}>Đăng xuất</button>
        </>
      ) : (
        <>
          <p>Đăng nhập bằng tài khoản trong realm <strong>sso-demo</strong>.</p>
          <button type="button" onClick={login}>Đăng nhập</button>
        </>
      )}
    </main>
  );
}
