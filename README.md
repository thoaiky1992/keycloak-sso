# Keycloak SSO với hai ứng dụng React

Dự án chạy PostgreSQL 16 và Keycloak 26.8.0 bằng Docker Compose. Một mã nguồn React được chạy thành hai ứng dụng tại `http://localhost:3000` và `http://localhost:3001`. Mỗi ứng dụng có một OIDC client riêng trong cùng realm `sso-demo`, nên có thể dùng chung phiên đăng nhập Keycloak.

Các lệnh dưới đây dùng terminal `zsh`/`bash`. Chạy từ thư mục gốc `keycloak-sso`, trừ khi có lệnh `cd react-app`. Cấu hình dùng HTTP và `start-dev` cho môi trường phát triển cục bộ.

## 1. Chuẩn bị

Cần cài và khởi động Docker Desktop (hoặc Docker Engine có Compose v2), Node.js 20+ và npm. Kiểm tra:

```sh
docker --version
docker compose version
node --version
npm --version
```

Nếu `docker compose` không kết nối được Docker daemon, hãy mở Docker Desktop và đợi Docker chạy xong.

### Chạy bằng Makefile

Từ thư mục gốc, có thể dùng các lệnh sau thay cho các lệnh cài đặt và khởi động thủ công ở bên dưới:

```sh
make init      # Tạo .env từ các file mẫu nếu chưa có
# Điền mật khẩu trong .env, Client secret trong backend-app/.env
make setup     # npm ci cho backend và React, kiểm tra Docker Compose
make infra     # Khởi động PostgreSQL và Keycloak để cấu hình realm/client
make start     # Chạy infra, backend và cả hai ứng dụng React
```

Trước `make start`, hoàn tất cấu hình realm, các client và user trong Keycloak theo các bước bên dưới. `make start-backend` chỉ chạy API; `make start-frontend` chạy cả hai ứng dụng React. Nhấn `Ctrl+C` để dừng các tiến trình Node, rồi dùng `make stop` để dừng container. `make init` không ghi đè các file `.env` đã có.

## 2. Tạo biến môi trường

Trong thư mục gốc:

```sh
cp .env.example .env
```

Mở `.env` bằng trình soạn thảo và thay **hai mật khẩu mẫu** bằng mật khẩu riêng:

```dotenv
POSTGRES_DB=keycloak
POSTGRES_USER=keycloak
POSTGRES_PASSWORD=<mat-khau-postgres-cua-ban>
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<mat-khau-admin-cua-ban>
```

Không nhập dấu `<` và `>` trong mật khẩu thật. `.env` đã nằm trong `.gitignore`. `KC_BOOTSTRAP_ADMIN_*` chỉ tạo tài khoản admin khi cơ sở dữ liệu còn mới; sửa `.env` sau đó không tự đổi mật khẩu admin hiện có.

Kiểm tra Compose đọc được cấu hình:

```sh
docker compose config --quiet
```

Lệnh không in gì và trả về thành công nghĩa là file YAML và `.env` hợp lệ.

## 3. Khởi động PostgreSQL và Keycloak

```sh
docker compose up -d
docker compose ps
docker compose logs -f keycloak
```

Compose sẽ tải image ở lần đầu. PostgreSQL cần đạt trạng thái `healthy` trước khi Keycloak khởi động. Khi log cho biết Keycloak đã khởi động ở cổng `8080`, nhấn `Ctrl+C` để ngừng xem log; container vẫn chạy. Kiểm tra endpoint:

```sh
curl -fsS http://localhost:8080/realms/master/.well-known/openid-configuration > /dev/null
```

Mở <http://localhost:8080/admin/> và đăng nhập bằng `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` trong `.env`. PostgreSQL chỉ nối vào mạng Docker nội bộ; Keycloak xuất ra `127.0.0.1:8080`. Dữ liệu realm, client và user nằm trong volume `postgres_data` nên vẫn còn sau `docker compose down`.

## 4. Tạo realm `sso-demo`

1. Trong Admin Console, mở menu chọn realm ở góc trên trái và chọn **Create realm**.
2. Nhập **Realm name** là `sso-demo`, giữ **Enabled** bật rồi chọn **Create**.
3. Trong **Realm settings → General**, có thể đặt **Display name** là `SSO Demo` và lưu. Tên này xuất hiện ở trang đăng nhập.
4. Kiểm tra menu chọn realm đang là `sso-demo` trước khi tạo client hoặc user. Không tạo các đối tượng mẫu trong realm `master`.

## 5. Bật Login theme tùy chỉnh

Compose mount [`themes/sso-demo`](themes/sso-demo) vào `/opt/keycloak/themes/sso-demo` trong container. Trong realm `sso-demo`:

1. Mở **Realm settings → Themes**.
2. Đặt **Login theme** là `sso-demo`.
3. Chọn **Save**.

```text
themes/sso-demo/
└── login/
    ├── login.ftl
    ├── theme.properties
    ├── messages/
    │   ├── messages_en.properties
    │   └── messages_vi.properties
    └── resources/
        ├── css/custom.css
        └── img/cloud-panel.svg
```

Theme dùng `login.ftl` dựa trên mẫu Keycloak 26.8.0 để thêm lời chào, biểu tượng và phần giới thiệu, đồng thời giữ nguyên các trường và luồng xác thực. CSS và SVG tạo giao diện tím/trắng như mẫu tham chiếu; trên màn hình nhỏ, form chuyển thành một thẻ trắng. Khi nâng cấp Keycloak, cần so sánh lại `login.ftl` với mẫu của phiên bản mới. Nếu theme chưa xuất hiện, kiểm tra `themes/sso-demo/login/theme.properties` rồi chạy `docker compose restart keycloak`.

Các mục **Remember me**, **Forgot password** và **Create account** chỉ hiện khi tính năng tương ứng được bật trong **Realm settings → Login**. Sau khi sửa CSS, tải lại trang đăng nhập; nếu vẫn thấy kiểu cũ, chạy `docker compose restart keycloak` rồi tải lại trang bằng cách bỏ cache trình duyệt.

## 6. Tạo hai OIDC client cho React

Tạo **hai client riêng** trong realm `sso-demo`. Với mỗi client, vào **Clients → Create client**:

1. Ở **General settings**, chọn **Client type** = `OpenID Connect`, nhập **Client ID** theo bảng và chọn **Next**.
2. Ở **Capability config**, đặt **Client authentication** = `Off` (public client), **Standard flow** = `On`, **Implicit flow** = `Off`, **Direct access grants** = `Off`, rồi chọn **Next**.
3. Ở **Login settings**, điền các URL theo bảng và chọn **Save**. Nếu màn hình tạo client chưa hiện một trường, mở client vừa lưu và chỉnh trong tab **Settings**.
4. Mở tab **Advanced** của client, tìm **PKCE Code Challenge Method**, chọn `S256` và lưu. Lặp lại cho client thứ hai.

| Trường | Ứng dụng 1 | Ứng dụng 2 |
| --- | --- | --- |
| Client ID | `react-app-3000` | `react-app-3001` |
| Root URL | `http://localhost:3000/` | `http://localhost:3001/` |
| Home URL | `http://localhost:3000/` | `http://localhost:3001/` |
| Valid redirect URIs | `http://localhost:3000/*` | `http://localhost:3001/*` |
| Valid post logout redirect URIs | `http://localhost:3000/*` | `http://localhost:3001/*` |
| Web origins | `http://localhost:3000` | `http://localhost:3001` |

Giữ chính xác giao thức `http`, hostname `localhost`, cổng và dấu `/` như trong bảng. Ứng dụng React chạy trong trình duyệt không dùng client secret. Hai client dùng Authorization Code Flow với PKCE `S256`.

## 7. Tạo user để đăng nhập

Trong realm `sso-demo`:

1. Vào **Users → Add user**.
2. Nhập **Username** (ví dụ `demo`), email hoặc tên nếu giao diện yêu cầu, giữ **Enabled** bật rồi chọn **Create**.
3. Mở user vừa tạo, vào tab **Credentials** và chọn **Set password**.
4. Nhập mật khẩu, đặt **Temporary** = `Off`, rồi xác nhận.

Tài khoản admin ở realm `master` dùng để quản lý Keycloak; dùng user trong `sso-demo` để thử đăng nhập ứng dụng.

## 8. Chạy hai ứng dụng React

Mở **terminal thứ nhất**, từ thư mục gốc dự án:

```sh
cd react-app
npm ci
npm run dev:app1
```

Giữ terminal này mở. Ứng dụng 1 chạy tại <http://localhost:3000/>. Mở **terminal thứ hai**, cũng từ thư mục gốc dự án:

```sh
cd react-app
npm run dev:app2
```

Ứng dụng 2 chạy tại <http://localhost:3001/>. Hai tiến trình dùng chung mã nguồn trong [`react-app/src`](react-app/src), nhưng `dev:app1` nạp `.env.app1` và `dev:app2` nạp `.env.app2`, nên mỗi cổng dùng đúng Client ID. Các biến `VITE_*` là cấu hình công khai trong trình duyệt; không đặt mật khẩu hoặc client secret vào đó.

## 9. Kiểm tra SSO

1. Mở <http://localhost:3000/>. Trang hiển thị **Ứng dụng 1** và nút **Đăng nhập**.
2. Chọn **Đăng nhập**. Trình duyệt chuyển đến trang Keycloak có theme `sso-demo`; nhập user đã tạo ở bước 7.
3. Sau khi trở lại ứng dụng 1, trang hiển thị tên user.
4. Trong **cùng trình duyệt và cùng hồ sơ trình duyệt**, mở <http://localhost:3001/>. Ứng dụng 2 kiểm tra phiên Keycloak (`check-sso`) và tự nhận đăng nhập mà không cần nhập lại mật khẩu.
5. Chọn **Đăng xuất** ở một ứng dụng để kết thúc phiên Keycloak. Tải lại tab ứng dụng còn lại để thấy trạng thái đã đăng xuất.

Mã React khởi tạo `keycloak-js` trước khi render, dùng PKCE `S256`, giữ token trong bộ nhớ và gọi `updateToken` khi cần.

## Backend Express API (tùy chọn)

Thư mục [`backend-app`](backend-app) cung cấp API đăng ký user, đăng nhập, tạo **Realm role** và tạo **Client role** trong realm `sso-demo`. Backend chạy riêng ở cổng `4000`, kết nối đến Keycloak ở `http://localhost:8080`. Các thao tác quản trị (tạo user/role, tra client) dùng [`@keycloak/keycloak-admin-client` 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/js/libs/keycloak-admin-client/README.md), khớp phiên bản server trong Compose. API đăng nhập và UserInfo dùng các endpoint OIDC của Keycloak. Mỗi request quản trị tạo một admin client riêng để token của các user không dùng chung.

### Tạo client `backend-app` trong Keycloak

1. Mở <http://localhost:8080/admin/>, đăng nhập tài khoản quản trị và chọn realm **`sso-demo`** ở góc trên trái. Client phải được tạo trong realm này, không phải `master`.
2. Vào **Clients → Create client**. Chọn **Client type** = `OpenID Connect`, nhập **Client ID** = `backend-app`, rồi chọn **Next**.
3. Ở **Capability config**, đặt các tùy chọn sau rồi chọn **Next**:

   | Tùy chọn | Giá trị |
   | --- | --- |
   | Client authentication | `On` |
   | Authorization | `Off` |
   | Standard flow | `Off` |
   | Direct access grants | `On` |
   | Service accounts roles | `On` |
   | Implicit flow | `Off` |

4. Ở **Login settings**, để trống các URL chuyển hướng và Web origins vì backend này không dùng luồng đăng nhập qua trình duyệt. Chọn **Save**. Nếu giao diện không hiện đủ tùy chọn ở bước trước, mở tab **Settings** của client vừa tạo để chỉnh và lưu lại.
5. Mở tab **Credentials** của `backend-app`, giữ **Client Authenticator** = `Client ID and Secret` và sao chép **Client secret**. Điền secret vào file `.env` tạo từ [`backend-app/.env.example`](backend-app/.env.example); không đưa vào React hoặc file `.http`.
6. Mở tab **Service account roles → Assign role**, lọc theo client **`realm-management`**, chọn **`manage-users`** rồi **Assign**. Service account dùng quyền này khi API `/api/users/register` tạo user. Không cấp `manage-realm` cho service account.
7. Mở **Client scopes** của `backend-app`, chọn scope riêng của client (thường tên `backend-app-dedicated`) → **Scope → Assign role**. Lọc theo client `realm-management`, chọn **`manage-users`**, **`manage-realm`** và **`manage-clients`**, rồi **Assign**. Giữ client scope mặc định **`roles`** để Keycloak đưa client roles vào claim `resource_access` của access token. Role scope chỉ cho phép role xuất hiện trong token; nó không tự cấp role đó cho user hay service account.
8. Để gọi API tạo role, vào **Users**, chọn hoặc tạo một user quản trị trong realm `sso-demo`, điền đầy đủ hồ sơ (gồm email), đặt mật khẩu không tạm thời, rồi mở **Role mapping → mũi tên cạnh Assign role → Filter by clients**. Lọc client `realm-management`: gán **`manage-realm`** để tạo Realm role và **`manage-clients`** để tạo Client role. Đây là *client roles* của `realm-management`, không nằm trong danh sách **Assign Realm roles**. Chỉ gán quyền cần dùng cho user quản trị; không gán cho user thông thường.

Keycloak chỉ đưa role vào token khi role vừa được gán cho user/service account, vừa nằm trong role scope mappings của client. Xem [hướng dẫn client và service account của Keycloak 26.8.0](https://www.keycloak.org/docs/26.8.0/server_admin/) nếu tên tab trong giao diện khác đôi chút.

Tạo cấu hình và chạy server trong terminal mới:

```sh
cd backend-app
# Chỉ tạo .env khi chưa có; điền Client secret vào KEYCLOAK_CLIENT_SECRET.
test -f .env || cp .env.example .env
npm ci
npm start
```

Trong môi trường cục bộ này, client `backend-app` đã được tạo với **Direct access grants** và **Service accounts roles**. Service account có `manage-users`. Để dùng API Client role vừa thêm, cần bổ sung `manage-clients` vào role scope của `backend-app` ở bước 7 và gán role đó cho user quản trị ở bước 8; cấu hình trước đó chỉ có `manage-users` và `manage-realm`. Secret của client nằm trong `backend-app/.env`; tài khoản và mật khẩu dùng trong các file `.http` nằm trong `backend-app/http/.env`. Cả hai file đều được Git bỏ qua. Khi thiết lập ở máy khác, tạo `backend-app/http/.env` từ [`backend-app/http/.env.example`](backend-app/http/.env.example) và điền mật khẩu user quản trị mới.

### Gọi API bằng file `.http`

Mở các file trong [`backend-app/http`](backend-app/http) bằng VS Code REST Client:

1. Gửi `health.http` để xác nhận Express chạy ở cổng `4000`.
2. Gửi `register.http` để tạo user. Đổi `username` và `email` khi gửi lại; trùng user sẽ trả `409`.
3. Gửi request đăng nhập trong `login.http` bằng tài khoản vừa tạo, sau đó gửi request bên dưới để lấy thông tin user từ `access_token`.
4. Trong `realm-roles.http`, gửi **adminLogin** trước, rồi gửi request tạo Realm role ngay bên dưới. Trong `client-roles.http`, gửi **clientAdminLogin** trước, rồi gửi request tạo Client role. Cả hai file đọc username/password từ `backend-app/http/.env` và lấy `access_token` từ response đăng nhập trong cùng file. Request Client role có `clientId` là **Client ID** trong Keycloak, ví dụ `react-app-3000`; backend tự tra UUID nội bộ. Tên role mẫu có timestamp để tránh trùng.

Access token hiện có thời hạn khoảng 5 phút. Nếu API tạo role trả `401 Invalid or expired token`, gửi lại request đăng nhập ở cùng file. Nếu trả `403`, kiểm tra token có `manage-realm` hoặc `manage-clients` phù hợp trong `resource_access["realm-management"].roles`, và kiểm tra bước 7–8. Nếu Client role trả `404`, kiểm tra `clientId` có tồn tại trong realm `sso-demo`. Nếu `/api/users/register` trả `502`, kiểm tra client secret và quyền `manage-users` ở bước 5–7. API đăng nhập giới hạn 10 lần thử trong 15 phút trên mỗi IP; khi nhận `429`, đợi hết cửa sổ giới hạn rồi thử lại.

Các endpoint:

| Method | Đường dẫn | Dữ liệu | Quyền |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | Công khai |
| `POST` | `/api/users/register` | `username`, `password`; tùy chọn `email`, `firstName`, `lastName` | Công khai, giới hạn 5 yêu cầu/giờ/IP |
| `POST` | `/api/auth/login` | `username`, `password` | Công khai, giới hạn 10 yêu cầu/15 phút/IP |
| `GET` | `/api/users/me` | Header `Authorization: Bearer <access_token>` | Access token hợp lệ trong realm `sso-demo` |
| `POST` | `/api/roles/realm` | `name`; tùy chọn `description` | Bearer access token có `realm-management → manage-realm` |
| `POST` | `/api/roles/client` | `clientId`, `name`; tùy chọn `description` | Bearer access token có `realm-management → manage-clients` |

`POST /api/roles` vẫn hoạt động như bí danh của `/api/roles/realm` để tương thích với request cũ. Xem Realm role tại **Realm roles**; xem Client role tại **Clients → chọn client → Roles**. API chỉ tạo role, chưa gán role cho user. Client role chỉ cần tên duy nhất trong client đó. Admin client gọi các endpoint tương ứng của [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html).

Khi tạo user, backend tự đặt `emailVerified: true` nếu request có `email` hợp lệ; nếu không có email, giá trị là `false`. Trường này được đặt trực tiếp trên Keycloak và không gửi email xác minh.

`GET /api/users/me` gọi Keycloak UserInfo bằng access token và trả về các claim mà Keycloak cho phép, như `sub`, `preferred_username`, `email`, `given_name` và `family_name` (tùy cấu hình scope và hồ sơ user). Response còn có `roles.realm` (danh sách Realm role) và `roles.clients` (Client role theo Client ID), lấy từ access token đã xác thực chữ ký. Ví dụ: `"roles": { "realm": ["viewer"], "clients": { "react-app-3000": ["editor"] } }`. Nếu token không có role claim, hai phần này lần lượt là `[]` và `{}`. Keycloak chỉ đưa role vào token khi cấu hình role scope mappings phù hợp.

API đăng nhập yêu cầu scope `openid` để UserInfo chấp nhận token. Sau khi cập nhật backend, gửi lại request đăng nhập trong `login.http` trước khi gọi `/api/users/me`; token cũ có thể đã hết hạn hoặc thiếu scope này. Token thiếu hoặc hết hạn trả `401`; response thành công không được cache.

Ví dụ:

```sh
curl -X POST http://localhost:4000/api/users/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"change-this-password","email":"alice@example.com"}'

curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"change-this-password"}'

# Đặt access token từ response đăng nhập vào ACCESS_TOKEN.
curl http://localhost:4000/api/users/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Đặt access token mới của user có manage-realm vào ADMIN_ACCESS_TOKEN.
curl -X POST http://localhost:4000/api/roles/realm \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"editor","description":"Can edit content"}'

# Với Client role, dùng token của user có manage-clients.
curl -X POST http://localhost:4000/api/roles/client \
  -H "Authorization: Bearer $CLIENT_ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"react-app-3000","name":"viewer","description":"Can view content"}'
```

API đăng nhập dùng **Direct Access Grant** theo yêu cầu gửi username/password đến backend. Keycloak [khuyến cáo dùng Authorization Code Flow thay cho luồng này](https://www.keycloak.org/securing-apps/oidc-layers) vì ứng dụng sẽ trực tiếp xử lý mật khẩu. Chỉ dùng API đăng nhập này cho demo cục bộ; hai ứng dụng React hiện có vẫn đăng nhập qua Keycloak bằng Authorization Code + PKCE. Không đưa client secret vào React hoặc commit file `.env`.

## 10. Dừng hoặc khởi động lại

Dừng hai Vite server bằng `Ctrl+C` trong từng terminal. Dừng container từ thư mục gốc:

```sh
docker compose down
```

Để chạy lại, dùng `docker compose up -d`, rồi chạy lại `npm run dev:app1` và `npm run dev:app2`. `docker compose down` vẫn giữ dữ liệu PostgreSQL. Nếu muốn **xóa toàn bộ realm, client và user để làm lại từ đầu**, chạy `docker compose down -v`.

## Lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| `docker compose up` không kết nối được Docker daemon | Mở Docker Desktop, đợi Docker sẵn sàng rồi chạy lại. |
| Keycloak chưa mở được ở cổng 8080 | Chạy `docker compose ps` và `docker compose logs keycloak`; kiểm tra cổng 8080 có bị ứng dụng khác dùng không. |
| PostgreSQL không `healthy` | Xem `docker compose logs postgres`; kiểm tra các biến `POSTGRES_*` trong `.env`. |
| Keycloak báo `invalid_redirect_uri` | Kiểm tra Client ID và **Valid redirect URIs** đúng cổng; dùng `localhost` ở cả trình duyệt và cấu hình client. |
| Ứng dụng báo lỗi CORS hoặc logout không quay lại ứng dụng | Kiểm tra **Web origins** và **Valid post logout redirect URIs** của đúng client. |
| Ứng dụng 2 yêu cầu nhập lại mật khẩu | Kiểm tra hai client ở cùng realm và hai tab dùng cùng hồ sơ trình duyệt; không trộn `localhost` với `127.0.0.1`. |
| Đổi mật khẩu admin trong `.env` nhưng mật khẩu cũ vẫn dùng được | Bootstrap admin chỉ được tạo khi dữ liệu còn mới; đổi mật khẩu trong Keycloak Admin Console nếu muốn giữ dữ liệu. |

Tài liệu tham khảo: [Keycloak container](https://www.keycloak.org/server/containers), [Keycloak JavaScript adapter](https://www.keycloak.org/securing-apps/javascript-adapter), [Keycloak themes](https://www.keycloak.org/ui-customization/themes).
