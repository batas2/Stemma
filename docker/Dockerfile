# syntax=docker/dockerfile:1.7

# ---- Frontend build ----
FROM node:24-alpine AS web-build
WORKDIR /app
COPY src/Verso.Web.Client/package.json src/Verso.Web.Client/package-lock.json* ./
RUN npm install --no-fund --no-audit --progress=false
COPY src/Verso.Web.Client/. ./
COPY src/Verso.Web/wwwroot ../Verso.Web/wwwroot
RUN npm run build

# ---- Backend publish ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnet-build
WORKDIR /src
COPY global.json Directory.Build.props NuGet.Config Verso.slnx ./
COPY src/Verso.Engine ./src/Verso.Engine
COPY src/Verso.Web ./src/Verso.Web
COPY tests ./tests
RUN dotnet restore src/Verso.Web/Verso.Web.csproj
COPY --from=web-build /app/wwwroot* ./src/Verso.Web/wwwroot/
RUN dotnet publish src/Verso.Web/Verso.Web.csproj -c Release -o /publish --no-restore

# ---- Runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=dotnet-build /publish ./
EXPOSE 5050
ENV ASPNETCORE_URLS=http://+:5050
ENTRYPOINT ["dotnet", "Verso.Web.dll"]
