export const protectedRoutes = ["/dashboard", "/verify-email"];
export const authRoutes = ["/login", "/register", "/verify-phone"];

export function isProtectedRoute(pathname: string) {
  return protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isAuthRoute(pathname: string) {
  return authRoutes.includes(pathname);
}
