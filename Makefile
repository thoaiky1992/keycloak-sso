.DEFAULT_GOAL := help

.PHONY: help init setup check-setup infra backend app1 app2 frontend start-backend start-frontend start stop

help:
	@echo "make init      - Tạo các file .env từ mẫu nếu chưa có"
	@echo "make setup     - Khởi tạo .env và cài dependencies cho backend/frontend"
	@echo "make infra     - Khởi động PostgreSQL và Keycloak"
	@echo "make backend   - Chạy backend tại http://localhost:4000"
	@echo "make frontend  - Chạy hai ứng dụng React tại cổng 3000 và 3001"
	@echo "make start-backend / start-frontend - Tên lệnh tương đương"
	@echo "make start     - Khởi động infra, backend và cả hai frontend"
	@echo "make stop      - Dừng PostgreSQL và Keycloak"

init:
	@for file in .env backend-app/.env backend-app/http/.env; do \
		if [ ! -f "$$file" ]; then \
			cp "$$file.example" "$$file" || exit 1; \
			echo "Đã tạo $$file"; \
		fi; \
	done

setup: init
	cd backend-app && npm ci
	cd react-app && npm ci
	docker compose config --quiet

check-setup:
	@test -f .env && test -f backend-app/.env && test -d backend-app/node_modules && test -d react-app/node_modules || { echo "Chạy make setup trước, sau đó cập nhật các file .env."; exit 1; }

infra:
	@test -f .env || { echo "Chạy make init và cập nhật .env trước."; exit 1; }
	docker compose config --quiet
	docker compose up -d

backend:
	@test -f backend-app/.env && test -d backend-app/node_modules || { echo "Chạy make setup trước, sau đó cập nhật backend-app/.env."; exit 1; }
	cd backend-app && npm start

app1:
	@test -d react-app/node_modules || { echo "Chạy make setup trước."; exit 1; }
	cd react-app && npm run dev:app1

app2:
	@test -d react-app/node_modules || { echo "Chạy make setup trước."; exit 1; }
	cd react-app && npm run dev:app2

frontend:
	$(MAKE) -j2 app1 app2

start-backend: backend

start-frontend: frontend

start: check-setup infra
	$(MAKE) -j3 backend app1 app2

stop:
	docker compose down
