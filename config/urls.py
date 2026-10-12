from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from finance.views import index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("senha/", auth_views.PasswordChangeView.as_view(), name="password_change"),
    path("senha/ok/", auth_views.PasswordChangeDoneView.as_view(), name="password_change_done"),
    path("api/", include("finance.urls")),
    path("", index, name="index"),
]
