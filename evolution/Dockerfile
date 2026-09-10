FROM evoapicloud/evolution-api@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339

WORKDIR /evolution

# Actualización exacta de la dependencia real baileys a la versión parcheada 7.0.0-rc13
# --save-exact actualiza package.json y package-lock.json manteniendo sincronizados package.json y node_modules
RUN npm install --save-exact --no-audit --no-fund baileys@7.0.0-rc13 \
    && npm ls baileys --depth=0 \
    && npm cache clean --force

# Patch causal determinista para eliminar timeout de 60s en profilePicture durante messages.upsert
COPY patch_profile_picture.js /evolution/patch_profile_picture.js
RUN node /evolution/patch_profile_picture.js \
    && rm /evolution/patch_profile_picture.js
