# syntax=docker/dockerfile:1.7

# ---- Frontend build ----
FROM node:24-alpine AS web-build
WORKDIR /app
COPY src/Stemma.Web.Client/package.json src/Stemma.Web.Client/package-lock.json* ./
RUN npm install --no-fund --no-audit --progress=false
COPY src/Stemma.Web.Client/. ./
COPY src/Stemma.Web/wwwroot ../Stemma.Web/wwwroot
RUN npm run build

# ---- Backend publish ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnet-build
WORKDIR /src
COPY global.json Directory.Build.props NuGet.Config Stemma.slnx ./
COPY src/Stemma.Engine ./src/Stemma.Engine
COPY src/Stemma.Web ./src/Stemma.Web
COPY tests ./tests
RUN dotnet restore src/Stemma.Web/Stemma.Web.csproj
COPY --from=web-build /app/wwwroot* ./src/Stemma.Web/wwwroot/
RUN dotnet publish src/Stemma.Web/Stemma.Web.csproj -c Release -o /publish --no-restore

# ---- Runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=dotnet-build /publish ./
EXPOSE 5050
ENV ASPNETCORE_URLS=http://+:5050
ENTRYPOINT ["dotnet", "Stemma.Web.dll"]
